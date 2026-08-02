'use client';

import { useEffect, useState } from 'react';
import type { AgentInputItem } from '@openai/agents';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import SendIcon from '@mui/icons-material/Send';
import { MessageBubbles } from '@/components/MessageBubbles';
import { PostSignInConfirmHandler } from '@/components/PostSignInConfirmHandler';
import { SamplePrompts } from '@/components/SamplePrompts';
import { UrlNoticeHandler } from '@/components/UrlNoticeHandler';
import { useAgentChat } from '@/hooks/useAgentChat';
import { useShareState } from '@/lib/share/ShareContext';

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
  const {
    messages,
    pending,
    send,
    conversationId: liveConversationId,
  } = useAgentChat({
    initialConversationId,
    initialHistory,
  });

  // input is the current text input from the user.
  const [input, setInput] = useState('');

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
          disabled={pending || !input.trim() || readOnly}
        >
          {pending ? <CircularProgress size={20} /> : <SendIcon />}
        </IconButton>
      </Box>
    </Container>
  );
}
