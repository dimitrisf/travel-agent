import { NextResponse } from 'next/server';
import { apiErrorResponse } from '@/utils/apiErrorResponse';
import { createConversationService } from '@/lib';
import { getCurrentUser } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/conversations
//
// Returns the current user's 10 most-recently-updated conversations.
// Consumed by the Header's Conversations dropdown. Signed-in only:
// anonymous callers get an empty list (not 401) so the dropdown can
// render gracefully for both auth states without conditional fetches.
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ conversations: [] });
    }

    const conversationService = createConversationService();

    const conversations = await conversationService.listForUser({
      userId: user.id,
    });

    return NextResponse.json({ conversations });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
