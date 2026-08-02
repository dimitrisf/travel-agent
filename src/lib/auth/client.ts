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

// Imperative sign-out. Triggers a POST to /api/auth/signout, which clears
// the session cookie AND (because we're on database session strategy)
// deletes the Session row via the Prisma adapter's deleteSession call.
// Defaults to redirecting to `/` (home) because "sign out and stay on
// the current URL" leads to bad UX: on a /c/[id] URL, sign-out would
// either bounce through the anon fallback back to `/` (extra redirect
// visible in the URL bar) or, if the conversation is shared, land the
// user on the read-only viewer view — not what someone clicking Sign
// out wants.
export async function signOutCurrent(callbackUrl?: string): Promise<void> {
  await signOut({
    callbackUrl: callbackUrl ?? '/',
  });
}
