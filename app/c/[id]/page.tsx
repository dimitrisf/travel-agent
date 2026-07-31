import { notFound, redirect } from 'next/navigation';
import { ChatContainer } from '@/components/ChatContainer';
import {
  createConversationService,
  isConversationServiceError,
} from '@/lib';
import { getCurrentUser } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ id: string }> };

// Resumed-conversation page. Server component: loads the conversation
// on the request (bypassing any /api/conversations fetch) and hands the
// full history + id to ChatContainer as initial state. useAgentChat's
// hydrateChatMessages call rebuilds the visible bubbles on mount.
//
// Auth: signed-in only. Anonymous callers get redirected to `/` rather
// than forced through the sign-in page — that's better UX for two flows:
//   (1) Sign-out from a /c/[id] URL: NextAuth returns you here, this
//       page sees no user, sends you to `/` (fresh anon chat). No
//       "you-just-signed-out-please-sign-back-in" whiplash.
//   (2) A shared or bookmarked /c/[id] URL opened by someone who isn't
//       signed in: they land on `/` and can decide to sign in from the
//       header if they want to.
// Signed-in-but-not-owner falls through to the loadForUser call below
// and gets a 404 (cross-tenant guard, no info leak).
export default async function ConversationPage({ params }: PageProps) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) {
    redirect('/');
  }

  const conversationService = createConversationService();
  try {
    const conversation = await conversationService.loadForUser({
      id,
      userId: user.id,
    });
    return (
      <ChatContainer
        initialConversationId={conversation.id}
        initialHistory={conversation.history}
      />
    );
  } catch (err) {
    // Cross-tenant or truly-missing both surface as CONVERSATION_NOT_FOUND.
    // Same 404 shape either way — no info leak on id enumeration.
    if (
      isConversationServiceError(err) &&
      err.code === 'CONVERSATION_NOT_FOUND'
    ) {
      notFound();
    }
    throw err;
  }
}
