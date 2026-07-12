'use client';

import { useEffect, useRef } from 'react';
import Stack from '@mui/material/Stack';
import type { ChatMessage } from '@/types/chat';
import { MessageBubble } from './MessageBubble';

// A scrollable vertical stack of MessageBubble entries — one per message.
// Owns its own bottomRef so it can auto-scroll to the newest bubble whenever
// the messages array changes, keeping page.tsx free of scroll concerns.
export function MessageBubbles({ messages }: { messages: ChatMessage[] }) {
  // bottomRef is a ref to an empty div at the bottom of the chat, used to scroll into view when new messages are added.
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to the bottom of the chat whenever messages change, so the latest message is visible.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <Stack spacing={2}>
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
      <div ref={bottomRef} />
    </Stack>
  );
}
