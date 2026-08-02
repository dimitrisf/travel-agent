'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

// Share state for the currently-viewed conversation (if any). Populated
// by the /c/[id] page's ChatContainer on mount; consumed by the Header
// to decide whether to render the Share icon button, and by the
// ShareModal to read/write the current shared flag.
//
// Why a Context and not props: Header is a sibling of the page (both
// live inside the root layout), so passing state from the page to the
// Header requires a shared store. The alternative — Header fetching
// ownership state on every page load via /api/conversations/[id] — would
// add a network round-trip that's mostly wasted (most navigations don't
// use it), so a client-side context is cheaper.
//
// Default value (no conversation being viewed): `conversationId: null`
// makes the Header's Share button check trivially fall through. The `/`
// page's ChatContainer also publishes this null state on mount to
// clear any lingering value from a prior /c/[id] view.
type ShareState = {
  conversationId: string | null;
  isOwner: boolean;
  shared: boolean;
};

type ShareContextValue = ShareState & {
  setShareState: (next: ShareState) => void;
  setShared: (shared: boolean) => void;
};

const ShareContext = createContext<ShareContextValue | null>(null);

const EMPTY: ShareState = {
  conversationId: null,
  isOwner: false,
  shared: false,
};

export function ShareProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ShareState>(EMPTY);

  // Convenience: only the shared flag changes on toggle (id/isOwner
  // stay put) — this saves callers from spreading the current state.
  // Note: this is a local-only update; the PATCH request to /api/conversations/[id]
  // is done in the ShareModal, not here.
  // This is a callback so the ShareModal can use it in its onClick handler
  // without re-rendering on every state change.
  const setShared = useCallback((shared: boolean) => {
    setState((prev) => ({ ...prev, shared }));
  }, []);

  return (
    <ShareContext.Provider
      value={{ ...state, setShareState: setState, setShared }}
    >
      {children}
    </ShareContext.Provider>
  );
}

export function useShareState(): ShareContextValue {
  const ctx = useContext(ShareContext);
  if (!ctx) {
    throw new Error('useShareState must be used inside <ShareProvider>');
  }
  return ctx;
}
