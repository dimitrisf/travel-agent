import { ChatContainer } from '@/components/ChatContainer';

// Fresh chat surface. Anonymous callers get tab-scoped state; signed-in
// callers get a Conversation row created on the first turn and the URL
// swapped to /c/[id] via history.replaceState so refresh + bookmarking
// work. See ChatContainer + useAgentChat for the hydration + swap logic.
export default function Home() {
  return <ChatContainer />;
}
