'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import { useCurrentUser } from '@/lib/auth/client';
import type { BookingLike } from '@/types/booking';
import {
  clearPendingSnackbar,
  readPendingSnackbar,
} from '@/utils/anonChatStorage';

// Post-sign-in Confirm surfacing on /c/[id]. Two paths, in order:
//
//   1. Common path — sessionStorage handoff. AnonChatResumeHandler
//      already fired the confirm POST in parallel with the
//      conversation-create POST on the previous route (`/?confirm=<id>`)
//      and stashed the snackbar copy. We just read + render + clear.
//      No POST here, no `booking-updated` dispatch either
//      (BookingCard consumes its own preconfirmed-booking key).
//
//   2. Fallback POST — for the edge case where someone lands on
//      /c/[id]?confirm=<id> directly (bookmarked URL, hand-typed) with
//      no sessionStorage handoff. Waits for auth to resolve, POSTs the
//      confirm route, dispatches `booking-updated` so any mounted
//      BookingCard for this id refreshes, and shows the snackbar. The
//      `?confirm=` param is stripped either way so a hard refresh
//      doesn't re-fire.
//
// pathname gate: only fires on /c/[id]. On the anon-Confirm-then-OAuth
// flow, the landing page is `/?confirm=<id>` — AnonChatResumeHandler
// runs there, and we deliberately don't. Firing on both would race.
export function PostSignInConfirmHandler() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const user = useCurrentUser();
  // Guard against React strict mode double-invoke — we only ever POST once.
  const firedRef = useRef(false);

  // Snackbar state: either from sessionStorage handoff or from the fallback POST. If null, render nothing.
  const [result, setResult] = useState<{
    severity: 'success' | 'error';
    message: string;
  } | null>(null);

  // Effect: on mount, check for a pending snackbar left by AnonChatResumeHandler. If found, consume it and render the snackbar. Otherwise, if on /c/[id]?confirm=<id> and the user is signed in, POST the confirm route and render the snackbar. The effect re-runs on searchParams, user, or pathname changes.
  useEffect(() => {
    // Guard against React strict mode double-invoke.
    if (firedRef.current) return;

    // Fast path: consume a snackbar left by AnonChatResumeHandler after
    // its parallel POST batch. No POST needed here — the confirm
    // already happened before navigation. Fires on any path (including
    // `/`) so if the user cancels the redirect flow and stays on `/`,
    // they still see the snackbar.
    // The fast path is a synchronous state upgrade — no network round-trip, no visible flicker from PROPOSED → PAID. The card just renders PAID from the first frame after mount.
    const pending = readPendingSnackbar();
    if (pending) {
      firedRef.current = true;
      clearPendingSnackbar();
      setResult(pending);
      return;
    }

    // At this point, we have no pending snackbar. If we're not on /c/[id], stop here — the fallback POST path only runs on /c/[id]. On `/`, the sibling AnonChatResumeHandler already owns the confirm (fires it as part of its parallel POST batch). If both fired, two POSTs to the same booking would race — the second would hit an already-PAID booking and 4xx. So we stop here and let AnonChatResumeHandler do its job. The snackbar it stashes will be picked up by the fast path when the user lands on /c/[id].

    // Fallback POST path — only fires on /c/[id].
    //
    // PostSignInConfirmHandler mounts on both `/` and /c/[id]. The fast
    // path above (consume snackbar from sessionStorage) runs on both.
    // But this fallback path — where WE actually POST
    // /api/booking/[id]/confirm — must NOT run on `/`, because on `/`
    // the sibling AnonChatResumeHandler already owns the confirm
    // (fires it as part of its parallel POST batch). If both fired,
    // two POSTs to the same booking would race — the second would hit
    // an already-PAID booking and 4xx.
    //
    // So: on `/`, stop here and let AnonChatResumeHandler do its job.
    // The snackbar it stashes will be picked up by the fast path when
    // the user lands on /c/[id].
    if (!pathname.startsWith('/c/')) return;

    // At this point, we have no pending snackbar and we're on /c/[id]. Check for a `?confirm=<id>` param. If not found, stop here — no confirm to fire. If found, check if the user is signed in. If not, stop here — we can't POST without auth. The effect will re-run when `user` changes (e.g., after OAuth redirect). If both are true, fire the confirm POST and render the snackbar.
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

        // The confirm route returns the full updated BookingLike, not
        // just { reference }. We use the whole shape both for the
        // snackbar text AND for the booking-updated event dispatch
        // below (so any mounted BookingCard for this id can refresh
        // its state without a race against its own mount-time refetch).
        const body = (await res.json()) as BookingLike & {
          error?: string;
        };

        if (!res.ok) {
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }

        // Fanout: any BookingCard for this id, wherever it is in the
        // React tree, updates itself. Same-tab only (window event),
        // which is exactly the scope we want — the tab that just did
        // the confirm is the one that has the stale card.
        if (typeof window !== 'undefined' && body.id) {
          // Dispatch a custom event with the updated booking as the detail. Any BookingCard listening for this event can update its state accordingly.
          window.dispatchEvent(
            new CustomEvent<BookingLike>('booking-updated', { detail: body }),
          );
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
  }, [searchParams, user, pathname]);

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
