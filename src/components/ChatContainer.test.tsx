// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChatMessage } from '@/types/chat';

// Mock every hook + side-effect handler ChatContainer pulls in.
// Individual tests reassign the useAgentChat return via
// useAgentChatMock.mockReturnValue({...}) below.

vi.mock('@/hooks/useAgentChat', () => ({
  useAgentChat: vi.fn(),
}));

vi.mock('@/lib/auth/client', () => ({
  useCurrentUser: vi.fn(() => null),
}));

vi.mock('@/context/ShareContext', () => ({
  useShareState: vi.fn(() => ({
    conversationId: null,
    isOwner: false,
    shared: false,
    setShareState: vi.fn(),
    setShared: vi.fn(),
  })),
}));

vi.mock('@/utils/anonChatStorage', () => ({
  readAnonChatHistory: vi.fn(() => null),
  saveAnonChatHistory: vi.fn(),
}));

// Stub the three mount-effect handler components — they trigger
// side effects (session storage reads, fetch calls) we don't need
// to exercise in a ChatContainer unit test.
vi.mock('@/components/AnonChatResumeHandler', () => ({
  AnonChatResumeHandler: () => null,
}));
vi.mock('@/components/PostSignInConfirmHandler', () => ({
  PostSignInConfirmHandler: () => null,
}));
vi.mock('@/components/UrlNoticeHandler', () => ({
  UrlNoticeHandler: () => null,
}));

// Stub MessageBubbles so we don't need to construct real ChatMessage
// shapes for the non-empty test. A data-testid marker is enough to
// prove the branch was rendered.
vi.mock('@/components/MessageBubbles', () => ({
  MessageBubbles: () => <div data-testid="message-bubbles" />,
}));

import { ChatContainer } from './ChatContainer';
import { useAgentChat } from '@/hooks/useAgentChat';

const useAgentChatMock = vi.mocked(useAgentChat);

function chatState(overrides: Partial<ReturnType<typeof useAgentChat>> = {}) {
  return {
    messages: [] as ChatMessage[],
    pending: false,
    send: vi.fn(),
    conversationId: null,
    history: [],
    ...overrides,
  } as ReturnType<typeof useAgentChat>;
}

describe('ChatContainer', () => {
  beforeEach(() => {
    useAgentChatMock.mockReturnValue(chatState());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('empty-vs-populated body', () => {
    it('renders SamplePrompts when messages is empty', () => {
      render(<ChatContainer />);
      expect(screen.getByText(/try one of these/i)).toBeInTheDocument();
      expect(screen.queryByTestId('message-bubbles')).not.toBeInTheDocument();
    });

    it('renders MessageBubbles when messages is non-empty', () => {
      useAgentChatMock.mockReturnValue(
        chatState({
          messages: [{ id: 'm1' } as ChatMessage],
        }),
      );

      render(<ChatContainer />);
      expect(screen.getByTestId('message-bubbles')).toBeInTheDocument();
      expect(screen.queryByText(/try one of these/i)).not.toBeInTheDocument();
    });
  });

  describe('submit gating', () => {
    it('keeps submit disabled while input is empty', () => {
      render(<ChatContainer />);
      const submit = screen.getByRole('button', { name: /send message/i });
      expect(submit).toBeDisabled();
    });

    it('enables submit once text is typed, and calls send with that text', async () => {
      const send = vi.fn();
      useAgentChatMock.mockReturnValue(chatState({ send }));

      const user = userEvent.setup();
      render(<ChatContainer />);

      const input = screen.getByRole('textbox');
      await user.type(input, 'Find flights');

      const submit = screen.getByRole('button', { name: /send message/i });
      expect(submit).toBeEnabled();

      await user.click(submit);
      expect(send).toHaveBeenCalledExactlyOnceWith('Find flights');
    });

    it('shows a spinner and disables submit while pending', () => {
      useAgentChatMock.mockReturnValue(chatState({ pending: true }));

      render(<ChatContainer />);
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /send message/i })).toBeDisabled();
    });
  });

  describe('read-only mode', () => {
    it('shows the read-only banner and disables input + submit when viewing a shared conversation as non-owner', () => {
      render(
        <ChatContainer
          initialConversationId="conv-123"
          initialHistory={[]}
          isOwner={false}
          initialShared={true}
        />,
      );

      expect(screen.getByText(/view-only/i)).toBeInTheDocument();
      expect(screen.getByRole('textbox')).toBeDisabled();
      expect(screen.getByRole('button', { name: /send message/i })).toBeDisabled();
    });
  });
});
