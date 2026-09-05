'use client';

import { useEffect, useMemo, useState } from 'react';
import type { AgentInputItem } from '@openai/agents';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import SendIcon from '@mui/icons-material/Send';
import { AnonChatResumeHandler } from '@/components/AnonChatResumeHandler';
import { MessageBubbles } from '@/components/MessageBubbles';
import { PostSignInConfirmHandler } from '@/components/PostSignInConfirmHandler';
import { SamplePrompts } from '@/components/SamplePrompts';
import { UrlNoticeHandler } from '@/components/UrlNoticeHandler';
import { useAgentChat } from '@/hooks/useAgentChat';
import { useCurrentUser } from '@/lib/auth/client';
import { useShareState } from '@/context/ShareContext';
import {
  readAnonChatHistory,
  saveAnonChatHistory,
} from '@/utils/anonChatStorage';

// Three gates matter:
// - currentUser || liveConversationId — once you're signed in or have a real DB conversation, the DB is the source of truth; sessionStorage stops being written.
// - liveHistory.length === 0 — this is the load-bearing one. On the post-OAuth mount, useAgentChat initializes with history=[] and useCurrentUser() returns null while the session resolves. If we cleared storage on empty here, we'd wipe the anon history milliseconds before AnonChatResumeHandler could read it. So empty is treated as "don't touch", not "clear". Explicit clears live in AnonChatResumeHandler after successful migration.
// Also, this required exposing history from useAgentChat (previously only messages — the UI-facing bubble form — was returned). See useAgentChat.ts. We save the canonical form so we can hand it back to the agent later.

// Client-side chat surface. Extracted from app/page.tsx so /c/[id] can
// reuse the same UI with a resumed conversation seeded in.
//
// Three modes:
//   - `/` (fresh, anon or signed-in)  → no props; full read/write
//   - `/c/[id]` as owner              → initialConversationId + isOwner=true; full read/write
//   - `/c/[id]` as viewer (shared)    → initialConversationId + isOwner=false; read-only
//
// Publishes share state to ShareContext on mount so the Header can
// render its Share button (only when isOwner + conversationId are set).
export function ChatContainer({
  initialConversationId,
  initialHistory,
  initialShared,
  isOwner,
}: {
  // initialConversationId is the conversation id from the URL (if any). If present, the hook will seed its state from that id and the initialHistory. If absent, the hook will create a new conversation on first send().
  initialConversationId?: string;
  initialHistory?: AgentInputItem[];
  // initialShared is the shared flag from the server-rendered conversation view. If present, it will be used to set the initial share state in the ShareContext. If absent, the share state will default to false.
  initialShared?: boolean;
  isOwner?: boolean;
}) {
  const readOnly = initialConversationId != null && !isOwner;

  // Anon-chat refresh preservation (Stage 17 Phase 3.5). If we're on `/`
  // (no server-provided initialConversationId) and sessionStorage has
  // a non-empty anon history, seed the hook with it. useAgentChat only
  // reads initialHistory in its useState initializer, so this must
  // happen synchronously on the first render — hence useMemo, not
  // useEffect. Handles two scenarios:
  //   - Tab refresh mid-anon-chat (F5) → chat comes back.
  //   - Post-OAuth mount on /?confirm=<id> → chat visible immediately
  //     before AnonChatResumeHandler completes its migration + nav to
  //     /c/[id]. No blank-canvas flicker during the resume round-trip.
  // Guarded by `!initialConversationId` so /c/[id] loads (which have
  // server-supplied history) never get overridden by stale storage.
  // useMemo is used instead of useEffect because the hook only reads initialHistory in its useState initializer, so we need to compute the restored history synchronously on the first render.
  // I.e., Because useAgentChat only reads initialHistory in its useState initializer — a useEffect-driven set would arrive after that initializer already ran with undefined, and the chat would render empty. useMemo produces a value available in the very first render.
  // In other words, we want to avoid a situation where the component renders with an empty history and then updates to the restored history after the effect runs, which would cause a flicker in the UI. By using useMemo, we ensure that the restored history is available on the first render.
  const restoredAnonHistory = useMemo(() => {
    // Initially, we check if there is an initialConversationId. If there is, we return undefined because we don't want to restore any anon history when the user is already in a conversation. This ensures that we only restore anon history when the user is on the root path (/) and not in a specific conversation.
    if (initialConversationId) return undefined;

    // Guard against server-side execution (no window) and private-mode
    // storage access errors. We don't want to crash the UI if the user is
    // in a weird environment.
    if (typeof window === 'undefined') return undefined;

    // At this point, we know we're on `/` (no conversation id) and the user is anonymous. We attempt to read the saved anon history from sessionStorage. If there is no saved history or if the saved history is empty, we return undefined. This ensures that we only restore non-empty histories to avoid overwriting any existing state with an empty array.

    const saved = readAnonChatHistory();

    if (!saved || saved.length === 0) return undefined;

    return saved;
  }, [initialConversationId]);

  // effectiveInitialHistory is the history that will be passed to the useAgentChat hook. It is either the initialHistory prop (if provided) or the restored anon history from sessionStorage. This ensures that we prioritize any server-provided initial history over any restored anon history, preventing stale data from being used when a user navigates to a conversation with an existing history.
  const effectiveInitialHistory = initialHistory ?? restoredAnonHistory;

  // Hydration-mismatch guard (Stage 17 Phase 3.5). The synchronous
  // sessionStorage read above returns different values on server
  // (undefined — no window) vs first client render (may have saved
  // history). Server would render <SamplePrompts /> (empty state) and
  // the client would render <MessageBubbles> with restored content —
  // React aborts hydration and logs an error. Fix: on `/` (no
  // server-provided initial state), suppress render until the mount
  // effect flips `mounted` true. First client render matches the
  // server's null → hydration succeeds → post-mount re-render shows
  // the restored content. /c/[id] pages have server-supplied history
  // so they SSR/hydrate correctly and skip this guard.
  const [mounted, setMounted] = useState(false);

  // This useEffect runs once on mount and sets the mounted state to true. This is used to prevent rendering the chat UI until after the component has mounted, which avoids hydration mismatches when restoring anon chat history from sessionStorage.
  useEffect(() => {
    setMounted(true);
  }, []);

  // messages, pending, send(), conversationId are owned by the chat hook.
  // In read-only mode we still hydrate messages from history but never
  // call send.
  //
  // `liveConversationId` is the hook's current conversation id. It gets
  // populated one of two ways depending on how this page was loaded:
  //   1. Loaded /c/[id]: id arrives as the `initialConversationId` prop,
  //      hook seeds its state from that. `liveConversationId` matches
  //      the prop from mount onwards.
  //   2. Loaded /: no id at mount. After the user sends their first
  //      turn, the /api/agent route creates a Conversation and echoes
  //      the new id back in the `done` event; the hook stores it AND
  //      swaps the URL to /c/[id] via history.replaceState.
  //      `liveConversationId` was null at mount and becomes truthy
  //      mid-lifetime.
  // The effect below watches `liveConversationId` (not just the prop) so
  // the Header's Share button appears in both cases — otherwise the
  // button would stay hidden after the URL swap on /.
  // `liveHistory` is the hook's current history. It starts from
  // `initialHistory` (or restored anon history) and grows as the user
  // sends turns.
  // The difference between messages and liveHistory is that messages is the hook's current state of messages to render, while liveHistory is the full history of all turns (including those that may not be rendered yet). In read-only mode, messages will be hydrated from liveHistory but send() will not be called, so messages will not grow beyond the initial history.
  const {
    messages,
    pending,
    send,
    conversationId: liveConversationId,
    history: liveHistory,
  } = useAgentChat({
    initialConversationId,
    initialHistory: effectiveInitialHistory,
  });

  // input is the current text input from the user.
  const [input, setInput] = useState('');

  // Anon-chat persistence (Stage 17 Phase 3.5). Auto-save the running
  // history to sessionStorage whenever it grows AND the user is
  // anonymous AND we're on `/` (no conversation id yet). Any sign-in
  // trigger (Confirm button, header Sign In) then leaves the state in
  // sessionStorage for AnonChatResumeHandler to pick up after the OAuth
  // redirect.
  //
  // Save condition is intentionally narrow:
  //   - Only write NON-EMPTY histories. On post-OAuth mount, the fresh
  //     ChatContainer initializes with history=[] and useCurrentUser()
  //     returns null while the session is still loading. If we cleared
  //     storage on empty here, we'd wipe the anon history a hair before
  //     AnonChatResumeHandler could read it. Explicit clears live in
  //     AnonChatResumeHandler (after successful migration).
  //   - Only anon-on-/ has ephemeral state worth preserving across the
  //     OAuth round-trip. Signed-in users write to the DB via
  //     /api/agent; /c/[id] pages load from the DB.
  const currentUser = useCurrentUser();

  // This useEffect runs whenever liveHistory, currentUser, or liveConversationId changes. It saves the current history to sessionStorage if the user is anonymous and on the root path (no conversation id). This ensures that the anon chat history is preserved across page refreshes or OAuth redirects.
  useEffect(() => {
    // Guard against saving when the user is signed in or when there's a live conversation id. We only want to save the history for anonymous users on the root path (no conversation id) to sessionStorage. If the user is signed in or has a live conversation, we don't need to save anything.
    if (currentUser || liveConversationId) return;

    // Here we know we're on `/` (no conversation id) and the user is anonymous. Save the current history to sessionStorage so it can be
    // restored after an OAuth round-trip.

    // Only save non-empty histories. An empty history could mean the user just loaded the page or cleared their chat, and we don't want to overwrite any existing saved history in sessionStorage with an empty array.
    //
    // Note: we intentionally do not clear sessionStorage on empty here. On post-OAuth mount, the fresh ChatContainer initializes with history=[] and useCurrentUser() returns null while the session is still loading. If we cleared storage on empty here, we'd wipe the anon history a hair before AnonChatResumeHandler could read it. Explicit clears live in AnonChatResumeHandler (after successful migration).
    if (liveHistory.length === 0) return;

    saveAnonChatHistory(liveHistory);
  }, [liveHistory, currentUser, liveConversationId]);

  // Publish this page's share state to the ShareContext so the Header
  // knows whether to render its Share button. Uses the numbered cases
  // documented above the useAgentChat call:
  //   - Case 1 (/c/[id] load): `liveConversationId === initialConversationId`
  //     from mount. `isOwner` comes straight from the prop the server
  //     computed (owner vs. read-only viewer of a shared conversation).
  //   - Case 2 (/ auto-created a conversation mid-lifetime):
  //     `initialConversationId` was undefined; `liveConversationId`
  //     turned truthy after the first turn's `done` event. In this case
  //     the caller MUST be the owner — /api/agent only creates
  //     conversations for signed-in users, under their userId — so we
  //     set `isOwner: true` unconditionally.
  //
  // Reset to the empty state on unmount so a Header rendered for a
  // different view doesn't inherit stale ownership.
  const { setShareState, shared: sharedFromContext } = useShareState();

  // Effect runs on mount and whenever the liveConversationId changes. It updates the ShareContext with the current conversation's id, ownership status, and shared flag. This ensures that the Header's Share button reflects the correct state for the currently viewed conversation.
  useEffect(() => {
    // If there's no live conversation id, clear the share state. This can happen if the user navigates away from a conversation or if the conversation is deleted. We want to ensure that the Share button in the Header does not remain visible when there is no active conversation.
    if (!liveConversationId) {
      setShareState({ conversationId: null, isOwner: false, shared: false });
      return;
    }

    // Determine if the live conversation id came from the initial props (i.e., the user loaded /c/[id]) or if it was created mid-lifetime (i.e., the user started a new conversation on /). This affects how we set the isOwner and shared flags in the ShareContext.
    const idCameFromProps =
      initialConversationId != null &&
      initialConversationId === liveConversationId;

    setShareState({
      conversationId: liveConversationId,
      // If the id came from props, use the isOwner and initialShared values from the server-rendered conversation view. If the id was created mid-lifetime, we know the user is the owner and the shared flag defaults to false.
      // ?? is used to provide a default value in case isOwner or initialShared are undefined. This ensures that the ShareContext always has a boolean value for these flags, preventing potential issues in the Header or ShareModal components that consume this context.
      isOwner: idCameFromProps ? (isOwner ?? false) : true,
      shared: idCameFromProps ? (initialShared ?? false) : false,
    });

    // Reset to the empty state on unmount so a Header rendered for a different view doesn't inherit stale ownership. This is important
    // for the `/` page, which is always mounted and never reloaded on
    // navigation — if a user opens a shared conversation and then goes
    // back to `/`, the Header should not still show the Share button.
    return () => {
      setShareState({ conversationId: null, isOwner: false, shared: false });
    };
  }, [
    liveConversationId,
    initialConversationId,
    isOwner,
    initialShared,
    setShareState,
  ]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!input.trim() || pending || readOnly) return;

    setInput('');
    send(input);
  }

  // See "Hydration-mismatch guard" comment above.
  if (!mounted && !initialConversationId) return null;

  return (
    <Container
      maxWidth="md"
      sx={{
        py: 4,
        height: 'calc(100vh - 64px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* AnonChatResumeHandler and PostSignInConfirmHandler are responsible for handling the post-OAuth redirect flow. They read the saved anon chat history and any pending snackbar from sessionStorage, and then perform the necessary API calls to migrate the anon chat to a real conversation and confirm any bookings. These components do not render any UI themselves; they only handle the background logic for the post-OAuth flow. */}
      {/* UrlNoticeHandler is responsible for displaying any notices related to the URL, such as query parameters that indicate a specific action or state. It reads the URL and displays any relevant messages to the user. This component does not handle any logic related to anon chat or bookings; it only displays notices based on the URL. */}
      <AnonChatResumeHandler />
      <PostSignInConfirmHandler />
      <UrlNoticeHandler />

      {readOnly && (
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          Shared conversation — view-only.{' '}
          {sharedFromContext
            ? 'The owner can revoke access at any time.'
            : null}
        </Alert>
      )}

      <Paper
        elevation={0}
        variant="outlined"
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 2,
          mb: 2,
          bgcolor: 'background.default',
        }}
      >
        {messages.length === 0 ? (
          <SamplePrompts onSelect={send} disabled={pending || readOnly} />
        ) : (
          <MessageBubbles messages={messages} />
        )}
      </Paper>

      <Box
        component="form"
        onSubmit={onSubmit}
        sx={{ display: 'flex', gap: 1 }}
      >
        <TextField
          fullWidth
          size="small"
          placeholder={
            readOnly
              ? 'Read-only — sign in and open your own chat to send messages.'
              : 'Ask about flights, hotels, or weather…'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={pending || readOnly}
        />
        <IconButton
          type="submit"
          color="primary"
          aria-label="Send message"
          disabled={pending || !input.trim() || readOnly}
        >
          {pending ? <CircularProgress size={20} /> : <SendIcon />}
        </IconButton>
      </Box>
    </Container>
  );
}
