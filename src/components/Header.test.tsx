// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock next/link so we can detect (via a marker attribute) any place
// Header uses it. The button-nav bug fixed in a prior PR was caused
// by <Link href="/"> going through Next.js's router — the router
// desyncs from the URL bar after window.history.replaceState, so
// the link no-ops instead of navigating. The title + "New chat"
// buttons must be plain <a href="/"> to force a full browser nav
// that doesn't ask the router's opinion. See src/components/Header.tsx.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: React.PropsWithChildren<{ href: string }>) => (
    <a href={href} data-next-link="true" {...rest}>
      {children}
    </a>
  ),
}));

// Mock the auth session hook. Two shapes tested below via reassignment.
vi.mock('@/lib/auth/client', () => ({
  useCurrentUser: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOutCurrent: vi.fn(),
}));

// Mock ShareContext so ShareButton can early-return (no conversation).
vi.mock('@/lib/share/ShareContext', () => ({
  useShareState: vi.fn(),
}));

// Mock ShareModal since ShareButton is guarded off in every test here
// (no conversationId + isOwner combo) and we don't want the modal's
// dependency tree pulled in.
vi.mock('@/components/ShareModal', () => ({
  ShareModal: () => null,
}));

import { Header } from './Header';
import { useCurrentUser } from '@/lib/auth/client';
import { useShareState } from '@/lib/share/ShareContext';

const useCurrentUserMock = vi.mocked(useCurrentUser);
const useShareStateMock = vi.mocked(useShareState);

describe('Header', () => {
  beforeEach(() => {
    useCurrentUserMock.mockReturnValue({
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
      image: null,
    });
    useShareStateMock.mockReturnValue({
      conversationId: null,
      isOwner: false,
      shared: false,
      setShareState: vi.fn(),
      setShared: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // Regression tests for the button-nav bug: both the title and the
  // "New chat" button must be plain <a href="/">, NOT next/link.
  // See src/components/Header.tsx and src/hooks/useAgentChat.ts
  // (adoptConversationId) for the interaction.
  describe('plain-anchor navigation to /', () => {
    it('renders the title as a plain <a href="/">, not a next/link', () => {
      render(<Header />);
      const title = screen.getByRole('link', { name: /travel assistant/i });
      expect(title).toHaveAttribute('href', '/');
      expect(title).not.toHaveAttribute('data-next-link');
    });

    it('renders "New chat" as a plain <a href="/">, not a next/link', () => {
      render(<Header />);
      const newChat = screen.getByRole('link', { name: /new chat/i });
      expect(newChat).toHaveAttribute('href', '/');
      expect(newChat).not.toHaveAttribute('data-next-link');
    });
  });

  describe('signed-in controls', () => {
    it('shows title, "New chat", Conversations, and avatar when signed in', () => {
      render(<Header />);
      expect(
        screen.getByRole('link', { name: /travel assistant/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /new chat/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /conversations/i }),
      ).toBeInTheDocument();
    });

    it('opens the Conversations menu on click and shows a spinner while loading', async () => {
      // Never-resolving fetch keeps the menu in its loading state so
      // we can assert the spinner. Real loading is short (~ms) and
      // hard to catch without controlling the timing here.
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(() => new Promise(() => {}));

      const user = userEvent.setup();
      render(<Header />);

      await user.click(screen.getByRole('button', { name: /conversations/i }));

      expect(fetchSpy).toHaveBeenCalledWith('/api/conversations');
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  describe('signed-out controls', () => {
    beforeEach(() => {
      useCurrentUserMock.mockReturnValue(null);
    });

    it('shows only the title and a Sign in button when signed out', () => {
      render(<Header />);
      expect(
        screen.getByRole('link', { name: /travel assistant/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('link', { name: /new chat/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /conversations/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /sign in/i }),
      ).toBeInTheDocument();
    });
  });
});
