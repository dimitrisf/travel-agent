'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import { useCurrentUser } from '@/lib/auth/client';
import type { BookingLike } from '@/types/booking';
import {
  clearAnonChatHistory,
  readAnonChatHistory,
  savePendingConfirmedBooking,
  savePendingSnackbar,
} from '@/utils/anonChatStorage';

// Bridges the Stage 17 Phase 3.5 anon-to-signed-in chat migration.
// Contract:
//   1. ChatContainer auto-saves the running anon history to
//      sessionStorage on every update (see the effect in ChatContainer).
//   2. User signs in mid-flow (Confirm button on a BookingCard, or the
//      header's Sign In). NextAuth redirects to Google, then back.
//   3. On the landing page, this component sees the fresh auth state
//      AND the saved history — POSTs the history to
//      /api/conversations to create a Conversation owned by the
//      now-signed-in user. If `?confirm=<bookingId>` is also in the
//      URL (i.e. the sign-in was triggered by a BookingCard Confirm
//      click), the booking-confirm POST fires in parallel with the
//      conversation-create POST — cuts the visible wait from ~6-8s
//      (two sequential Neon round-trips) to ~3-4s (one concurrent
//      batch). The confirm result is stashed in sessionStorage so
//      BookingCard on /c/[id] can pick it up on mount and skip its
//      refetch, and PostSignInConfirmHandler shows the snackbar
//      without re-POSTing.
//
// Only fires once per mount (firedRef guard) and only when the two
// preconditions align: signed-in user + saved anon history. Missing
// either → no-op.
export function AnonChatResumeHandler() {
  const router = useRouter();
  const user = useCurrentUser();

  // Guard against double-firing. The effect below is dep-free (only reads user and router from closure) so it can run multiple times in a single mount if the component re-renders. We only want to fire once per mount, so we use a ref to track whether we've already fired.
  const firedRef = useRef(false);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Bail if we've already fired, or if the user isn't signed in yet. We only want to fire once per mount, and only when the user is signed in and there's saved anon history to migrate.
    if (firedRef.current) return;
    if (!user) return;

    // Read the anonymous history from session storage. Bail if there's no saved anon history. We only want to fire when there's saved anon history to migrate.
    const savedHistory = readAnonChatHistory();
    if (!savedHistory || savedHistory.length === 0) return;

    firedRef.current = true;

    // Detect the anon-Confirm-then-OAuth flow: the query param
    // `?confirm=<numericBookingId>` is written by BookingCard right
    // before signInWithGoogle(callbackUrl). If present, fire the confirm
    // POST in parallel with the conversation-create POST below.
    // Reading window.location.search directly (vs useSearchParams)
    // keeps this effect dep-free — we only care about the value at the
    // moment we fire, and firedRef prevents re-entry.
    // urlConfirmId is the value of the confirm query parameter in the URL, i.e., the numeric booking ID if present. If it's a valid positive integer, we set shouldConfirm to true and parse it as a number. Otherwise, shouldConfirm is false and parsedConfirmId is null.
    const urlConfirmId = new URLSearchParams(window.location.search).get(
      'confirm',
    );
    const parsedConfirmId = urlConfirmId ? Number(urlConfirmId) : null;
    const shouldConfirm =
      parsedConfirmId !== null &&
      Number.isInteger(parsedConfirmId) &&
      parsedConfirmId > 0;

    // void means we don't care about the return value of the async function. We just want to fire it and let it run in the background. Any errors will be caught and handled inside the async function, so we don't need to await it here.
    void (async () => {
      try {
        // Kick off both POSTs concurrently. Each takes ~3-4s on Neon,
        // so serial (previous impl) was ~6-8s total; parallel is
        // bounded by the slower of the two.
        const [convRes, confirmRes] = await Promise.all([
          // First POST: create a new conversation with the saved anon history (savedHistory). This is mandatory for navigation to /c/[id], so we await it and check for errors. If it fails, we throw an error and bail out of the migration.
          fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history: savedHistory }),
          }),
          shouldConfirm
            ? // This means that the user has just completed the OAuth flow and is waiting for the AnonChatResumeHandler to complete the confirmation process. We fire the booking-confirm POST in parallel with the conversation-create POST. This is best-effort: if it fails, we still navigate to /c/[id] and show a snackbar with the error message. If it succeeds, we save the confirmed booking in sessionStorage so BookingCard on /c/[id] can pick it up on mount and skip its refetch.
              // The oAuth flow has been triggered by the user clicking the Confirm button on a BookingCard, which sets the confirm query parameter in the URL. We read that parameter here and use it to determine whether to fire the booking-confirm POST.
              fetch(`/api/booking/${parsedConfirmId}/confirm`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
              })
            : // If there's no confirm query parameter in the URL, we don't need to fire the booking-confirm POST. We return a resolved promise with null so that Promise.all still resolves and we can handle the conversation-create POST result.
              Promise.resolve(null),
        ]);

        // Handle the conversation-create POST result. If it fails, we throw an error and bail out of the migration. If it succeeds, we parse the response body and check for the conversation ID. If it's missing, we throw an error and bail out of the migration.
        const convBody = (await convRes.json()) as {
          id?: string;
          error?: string;
        };
        if (!convRes.ok || !convBody.id) {
          throw new Error(convBody.error ?? `HTTP ${convRes.status}`);
        }

        // The confirm arm is best-effort. A conversation-create success
        // is mandatory for navigation; a confirm failure is surfaced
        // via the snackbar (still navigates so the user isn't stranded
        // on `/`).
        if (shouldConfirm && confirmRes) {
          const confirmBody = (await confirmRes.json()) as BookingLike & {
            error?: string;
          };

          if (confirmRes.ok && confirmBody?.id) {
            // Save the confirmed booking and a success snackbar message in sessionStorage so BookingCard on /c/[id] can pick it up on mount and skip its refetch, and PostSignInConfirmHandler can show the snackbar without re-POSTing. We use the booking reference if available, otherwise we fall back to the parsedConfirmId from the URL.

            savePendingConfirmedBooking(confirmBody);

            savePendingSnackbar({
              severity: 'success',
              message: `Booking ${confirmBody.reference ?? parsedConfirmId} confirmed.`,
            });
          } else {
            savePendingSnackbar({
              severity: 'error',
              message: `Couldn't confirm booking: ${
                confirmBody?.error ?? `HTTP ${confirmRes.status}`
              }`,
            });
          }
        }

        // Success — clear storage BEFORE navigation so a race with
        // ChatContainer's auto-save effect on the new page can't
        // rewrite it.
        clearAnonChatHistory();

        // Strip `?confirm=` before navigating — we already handled it
        // in the parallel POST, and PostSignInConfirmHandler must not
        // see it (else it would re-POST and either double-confirm the
        // now-PAID booking or 404). Preserve any other params.

        // Build the target URL for navigation. We create a new URL object with the path `/c/${convBody.id}` and the current origin.
        // window.location.origin gives us the current origin (protocol + host + port) of the page, so we can construct a full URL for the new conversation page.
        const target = new URL(`/c/${convBody.id}`, window.location.origin);

        // Preserve any other query parameters from the current URL, except for the `confirm` parameter. We iterate over the current search parameters and copy them to the target URL's search parameters, skipping the `confirm` parameter.
        // This ensures that any other query parameters (e.g., tracking, state) are preserved when we navigate to the new conversation page.
        // windows.location.search gives us the query string of the current URL, which we can parse using URLSearchParams to get the individual parameters.
        const currentParams = new URLSearchParams(window.location.search);
        currentParams.forEach((value, key) => {
          if (key === 'confirm') return;
          target.searchParams.set(key, value);
        });

        // Finally, navigate to the new conversation page with the constructed URL. We use router.replace to replace the current history entry with the new one, so that the user doesn't have to click back twice to return to the previous page. This also prevents the user from accidentally resubmitting the form if they refresh the page.
        router.replace(target.pathname + target.search);
      } catch (err) {
        // Migration failed — leave the sessionStorage in place so a
        // manual refresh can retry, and surface the error inline.
        setError(
          `Couldn't resume your chat: ${(err as Error).message}. Try refreshing.`,
        );
      }
    })();
  }, [user, router]);

  // If there's no error, we don't render anything. The component is only responsible for handling the migration and showing an error if it fails. If the migration succeeds or hasn't been triggered yet, we return null to render nothing.
  if (!error) return null;

  return (
    <Alert
      severity="warning"
      variant="outlined"
      onClose={() => setError(null)}
      sx={{ mb: 2 }}
    >
      {error}
    </Alert>
  );
}
