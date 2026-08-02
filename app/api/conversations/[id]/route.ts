import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/utils/apiErrorResponse';
import { createConversationService } from '@/lib';
import { getCurrentUser } from '@/lib/auth/session';

// runtime = 'nodejs' and dynamic = 'force-dynamic' are required for this route to work in the Edge runtime. The route needs to be dynamic because it depends on the conversation id in the URL, which is not known at build time. The nodejs runtime is used because the route performs server-side operations that require Node.js APIs, such as fetching data from a database or calling other server-side services.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Route context type for the PATCH /api/conversations/[id] endpoint. The context contains the route parameters, which include the conversation id extracted from the URL. The id is a string that uniquely identifies the conversation to be updated. The params property is a Promise that resolves to an object containing the id, allowing for asynchronous retrieval of route parameters if needed.
type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/conversations/[id]
//
// Owner-only. Toggles the `shared` flag on a conversation. Body:
// `{ shared: boolean }`. Returns the new `{ shared }` value so the client
// can optimistically update UI. Cross-tenant callers get 404-shaped
// errors from the service layer (via assertOwnership inside setShared).
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { id } = await ctx.params;

  if (!id) {
    return NextResponse.json(
      { error: 'Invalid conversation id.' },
      { status: 400 },
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Sign in required.', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  let body: { shared?: unknown };

  try {
    body = (await req.json()) as { shared?: unknown };
  } catch {
    return NextResponse.json(
      { error: 'Body must be JSON with a `shared` boolean.' },
      { status: 400 },
    );
  }

  if (typeof body.shared !== 'boolean') {
    return NextResponse.json(
      { error: '`shared` must be a boolean.' },
      { status: 400 },
    );
  }

  const conversationService = createConversationService();
  try {
    // Call the service layer to update the shared flag. The service layer handles ownership validation and updates the database. If the user is not the owner of the conversation, a 404-shaped error is thrown, which is caught and returned as a 404 response to avoid leaking information about the existence of the conversation.
    // The service returns the new shared value, which is sent back to the client for optimistic UI updates.
    const result = await conversationService.setShared({
      id,
      userId: user.id,
      shared: body.shared,
    });

    // Return the new shared value so the client can optimistically update UI
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
