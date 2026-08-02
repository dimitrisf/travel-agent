import { notFound, redirect } from 'next/navigation';
import { ChatContainer } from '@/components/ChatContainer';
import { createConversationService } from '@/lib';
import { getCurrentUser } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ id: string }> };

// Resumed-conversation page. Server component: loads the conversation
// on the request and hands the full history + id + share metadata to
// ChatContainer as initial state. useAgentChat's hydrateChatMessages
// call rebuilds the visible bubbles on mount.
//
// Access (Stage 17 Phase 4):
//   - Owner (signed-in, userId matches) → full read/write access
//   - Anyone else (signed-in OR anonymous) → allowed IF conversation.shared
//     is true; view is read-only (input disabled, banner shown)
//   - Not viewable → 404 for signed-in visitors, redirect to `/` for anon.
//     Same info-leak guard: cross-tenant existence is never revealed.
export default async function ConversationPage({ params }: PageProps) {
  const { id } = await params;
  const user = await getCurrentUser();

  const conversationService = createConversationService();

  // Load the conversation for the current viewer. Returns null if not viewable
  // (doesn't exist, or exists but not shared and caller isn't the owner).
  // The service layer handles ownership validation and returns a ConversationView
  // object with the conversation's metadata and history if viewable.
  const conversationView = await conversationService.loadForViewer({
    id,
    viewerId: user?.id ?? null,
  });

  if (!conversationView) {
    // Not viewable — either doesn't exist, or exists but not shared and
    // caller isn't the owner. Same 404 shape either way (no info leak
    // on id enumeration). Anon visitors get redirected to `/` with a
    // `?notice=conversation-unavailable` query param — UrlNoticeHandler
    // on the landing page reads it and shows an Alert explaining why
    // they didn't land where they expected. Signed-in visitors get the
    // real Next.js 404 page (cross-tenant scenario, cleaner signal).
    if (user) notFound();

    redirect('/?notice=conversation-unavailable');
  }

  return (
    <ChatContainer
      initialConversationId={conversationView.id}
      initialHistory={conversationView.history}
      initialShared={conversationView.shared}
      isOwner={conversationView.isOwner}
    />
  );
}
