'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import SendIcon from '@mui/icons-material/Send';
import { MessageBubbles } from '@/components/MessageBubbles';
import { PostSignInConfirmHandler } from '@/components/PostSignInConfirmHandler';
import { SamplePrompts } from '@/components/SamplePrompts';
import { useAgentChat } from '@/hooks/useAgentChat';

export default function Home() {
  // messages, pending, and send() are owned by the chat hook. The rest of
  // this component only manages the text input and the autoscroll ref.
  const { messages, pending, send } = useAgentChat();

  // input is the current text input from the user.
  const [input, setInput] = useState('');

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || pending) return;
    setInput('');
    send(input);
  }

  return (
    <Container
      maxWidth="md"
      sx={{
        py: 4,
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <PostSignInConfirmHandler />
      <Typography variant="h4" gutterBottom>
        Travel Assistant
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Chat with a travel-planning agent backed by OpenAI + MCP.
      </Typography>

      <Paper
        elevation={0}
        variant="outlined"
        sx={{
          flex: 1,
          overflow: 'auto',
          p: 2,
          mt: 2,
          mb: 2,
          bgcolor: 'background.default',
        }}
      >
        {messages.length === 0 ? (
          <SamplePrompts onSelect={send} disabled={pending} />
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
          placeholder="Ask about flights, hotels, or weather…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={pending}
        />
        <IconButton
          type="submit"
          color="primary"
          disabled={pending || !input.trim()}
        >
          {pending ? <CircularProgress size={20} /> : <SendIcon />}
        </IconButton>
      </Box>
    </Container>
  );
}
