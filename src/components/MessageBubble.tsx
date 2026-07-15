'use client';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ChatMessage } from '@/types/chat';
import { ToolCallView } from './ToolCallView';

// A single chat message, either from the user or the agent. Shows the text
// content; for agent messages, also renders handoff chips (Triage → Weather /
// Travel) and tool-call accordions (or rich BookingCards for booking tools).
// MessageBubble displays a single chat message, either from the user or the agent. It shows the message text, and if the message is from the agent and has tool calls, it displays each tool call in an accordion that can be expanded to show the arguments and output.
export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  const isBlocked = !!message.blockedBy;
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      <Box sx={{ maxWidth: '85%' }}>
        <Paper
          elevation={0}
          sx={{
            p: 1.5,
            // Blocked messages get a warning-tinted background and border,
            // distinct from both normal agent replies (paper) and errors
            // (which the caller would style via text prefix). Signals
            // "the system stepped in on purpose" without shouting failure.
            bgcolor: isUser
              ? 'primary.main'
              : isBlocked
                ? 'rgba(237, 108, 2, 0.08)'
                : 'background.paper',
            color: isUser ? 'primary.contrastText' : 'text.primary',
            border: isUser ? 'none' : '1px solid',
            borderColor: isBlocked ? 'warning.main' : 'divider',
            whiteSpace: 'pre-wrap',
          }}
        >
          {/* The following line displays the message text or a loading indicator if the message is pending and has no tool calls. */}
          {message.text ||
            (message.pending && message.toolCalls.length === 0 ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={14} />
                <Typography variant="body2" color="text.secondary">
                  thinking…
                </Typography>
              </Box>
            ) : null)}
        </Paper>
        {/* Guardrail-blocked chip — surfaces the reason the message looks
            different so it's not mistaken for a bug or a network hiccup. */}
        {isBlocked && (
          <Chip
            label={
              message.blockedBy?.kind === 'input'
                ? 'Blocked by input guardrail'
                : 'Blocked by output guardrail'
            }
            size="small"
            color="warning"
            variant="outlined"
            sx={{ mt: 0.5 }}
          />
        )}
        {/* Handoff chips — one per agent switch during the turn (Triage → Weather / Travel). */}
        {!isUser && message.handoffs.length > 0 && (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ mt: 0.5, flexWrap: 'wrap', gap: 0.5 }}
          >
            {message.handoffs.map((agentName, i) => (
              <Chip
                key={`${i}-${agentName}`}
                label={`→ ${agentName}`}
                size="small"
                variant="outlined"
                color="secondary"
              />
            ))}
          </Stack>
        )}
        {/* The following line displays the tool calls if the message is from the agent and has tool calls. */}
        {!isUser && message.toolCalls.length > 0 && (
          <Stack spacing={0.5} sx={{ mt: 0.5 }}>
            {message.toolCalls.map((tc, i) => (
              <ToolCallView key={i} toolCall={tc} />
            ))}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
