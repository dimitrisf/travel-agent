'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import { useCurrentUser } from '@/lib/auth/client';

// Bridges the Phase 2 anon-Confirm-click → OAuth → sign-in loop back to
// actually calling /api/booking/[id]/confirm. Without this, an anonymous
// user who clicks Confirm on a BookingCard, signs in via Google, and
// returns to `/` sees a signed-in header but nothing happens — the chat
// state (and therefore the BookingCard) doesn't survive the redirect.
//
// Contract: BookingCard.tsx encodes the pending booking id as a query
// param on the OAuth callback URL (`/?confirm=<id>`). This component
// mounts on the landing page, notices the param, waits for `useCurrentUser`
// to resolve to a signed-in identity, then POSTs the confirm route and
// shows a Snackbar with the result. The query param is stripped from the
// URL after firing so a hard refresh doesn't re-trigger.
//
// Note: this is a client component because it uses `useSearchParams` and
// `useCurrentUser`. It doesn't render anything itself, just the Snackbar.
//
// (Copied from Claude Code:)
// The load-bearing UX fix that made the anon-Confirm-then-sign-in loop actually work end-to-end. Wired into app/page.tsx at the top of the container.

// - Reads ?confirm=<id> from useSearchParams()
// - Waits for useCurrentUser() to resolve to a signed-in identity (handles the race where auth state hasn't populated on first render post-OAuth)
// - POSTs /api/booking/<id>/confirm, snackbar with the result
// - Strips the query param via history.replaceState so a refresh doesn't re-confirm
// - Uses a useRef guard against React strict-mode double-invoke
export function PostSignInConfirmHandler() {
  const searchParams = useSearchParams();
  const user = useCurrentUser();
  // Guard against React strict mode double-invoke — we only ever POST once.
  const firedRef = useRef(false);

  const [result, setResult] = useState<{
    severity: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    // Guard against React strict mode double-invoke — we only ever POST once.
    if (firedRef.current) return;

    const confirmId = searchParams.get('confirm');
    if (!confirmId) return;

    // If the user isn't signed in yet, wait — could be a race where auth
    // state hasn't populated on first render, or the user cancelled OAuth
    // and needs to sign in via the header. Either way, the effect re-runs
    // when `user` changes.
    if (!user) return;

    firedRef.current = true;

    // Strip the param synchronously so a refresh or accidental back-nav
    // doesn't re-confirm.
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('confirm');
    window.history.replaceState({}, '', cleanUrl.toString());

    // Fire the confirm API call. We don't await it in the effect because we want to avoid a React warning about returning a promise from useEffect. Instead, we define an async IIFE (i.e., Immediately Invoked Function Expression) and call it immediately.
    void (async () => {
      try {
        const res = await fetch(`/api/booking/${confirmId}/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        const body = (await res.json()) as {
          reference?: string;
          error?: string;
        };

        if (!res.ok) {
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        setResult({
          severity: 'success',
          message: `Booking ${body.reference ?? confirmId} confirmed.`,
        });
      } catch (err) {
        setResult({
          severity: 'error',
          message: `Couldn't confirm booking: ${(err as Error).message}`,
        });
      }
    })();
  }, [searchParams, user]);

  if (!result) return null;

  return (
    <Snackbar
      open
      autoHideDuration={6000}
      onClose={() => setResult(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
    >
      <Alert
        severity={result.severity}
        onClose={() => setResult(null)}
        variant="filled"
      >
        {result.message}
      </Alert>
    </Snackbar>
  );
}
