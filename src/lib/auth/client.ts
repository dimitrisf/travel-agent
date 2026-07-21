'use client';

import { signIn, signOut, useSession } from 'next-auth/react';
import type { CurrentUser } from './session';

// Client-side reactive session read. Re-renders when auth state changes.
// Returns null while loading OR when not signed in — the UI treats "loading"
// and "signed out" identically for Phase 1 (no protected client components
// yet). If we ever need to distinguish, expose the raw status.
export function useCurrentUser(): CurrentUser | null {
  const { data: session, status } = useSession();
  if (status !== 'authenticated' || !session?.user?.email) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
  };
}

// Imperative sign-in — Google OAuth flow. Redirects to Google, then back to
// the current URL after successful sign-in. `callbackUrl` defaults to the
// current page (window.location.href) which is what users expect (sign in, stay where you are).
export async function signInWithGoogle(callbackUrl?: string): Promise<void> {
  await signIn('google', {
    callbackUrl: callbackUrl ?? window.location.href,
  });
}

// Imperative sign-out — clears the session cookie AND deletes the Session
// row from the DB (database session strategy). Returns to the current URL.
export async function signOutCurrent(callbackUrl?: string): Promise<void> {
  await signOut({
    callbackUrl: callbackUrl ?? window.location.href,
  });
}
