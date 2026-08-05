import { NextRequest, NextResponse } from 'next/server';
import type { AgentInputItem } from '@openai/agents';
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

// POST /api/conversations
//
// Import an existing history array as a new Conversation for the
// current user. Used by AnonChatResumeHandler (Stage 17 Phase 3.5)
// to migrate an anonymous user's tab-scoped chat into a signed-in
// Conversation after OAuth sign-in mid-flow.
//
// Body: `{ history: AgentInputItem[] }`. Response: `{ id: string }`
// where `id` is the new Conversation's cuid — the client then
// navigates to /c/[id] with any preserved query params.
//
// Auth: requires session (401 otherwise). Title is auto-derived from
// the first user message in `history` (see ConversationService.create).
export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        {
          error: 'Sign in required to import a conversation.',
          code: 'UNAUTHORIZED',
        },
        { status: 401 },
      );
    }

    let body: { history?: unknown };
    try {
      body = (await req.json()) as { history?: unknown };
    } catch {
      return NextResponse.json(
        { error: 'Body must be JSON with a `history` array.' },
        { status: 400 },
      );
    }

    if (!Array.isArray(body.history) || body.history.length === 0) {
      return NextResponse.json(
        { error: '`history` must be a non-empty array of AgentInputItem.' },
        { status: 400 },
      );
    }

    const history = body.history as AgentInputItem[];

    const conversationService = createConversationService();
    // Atomic create + append. Title is derived from the first user
    // message in `history`; every message in `history` is persisted in
    // the same transaction. If the message insert fails, the
    // Conversation row rolls back — no orphan titled-but-empty ghost.
    // /api/agent uses the two-step create() + appendTurn() path
    // instead, because the id must be returned to the client mid-stream
    // before the turn's messages exist.
    const created = await conversationService.createWithSeed({
      userId: user.id,
      history,
    });

    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
