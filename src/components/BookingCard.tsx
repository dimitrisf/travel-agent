'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActions from '@mui/material/CardActions';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import FlightIcon from '@mui/icons-material/Flight';
import HotelIcon from '@mui/icons-material/Hotel';
import type { BookingLike } from '@/types/booking';
import { statusChipColor } from '@/utils/booking';
import { formatEUR } from '@/utils/format';
import { FlightLegRows } from './FlightLegRows';
import { HotelStayRows } from './HotelStayRows';
import { useCurrentUser, signInWithGoogle } from '@/lib/auth/client';
import {
  clearPendingConfirmedBooking,
  readPendingConfirmedBooking,
} from '@/utils/anonChatStorage';

// A booking rendered as a rich MUI Card with flights, hotels, total, and
// action buttons. The card owns its own state for the current booking
// snapshot so Confirm / Cancel actions update it in place without touching
// the surrounding chat message.
export function BookingCard({
  initialBooking,
}: {
  initialBooking: BookingLike;
}) {
  // booking is the current snapshot of the booking, which may be updated by Confirm or Cancel actions. We initialize it with the initialBooking prop, which is the booking data parsed from the tool output. The card owns its own state for the current booking snapshot so Confirm / Cancel actions update it in place without touching the surrounding chat message.
  const [booking, setBooking] = useState<BookingLike>(initialBooking);

  // The busy state tracks whether a Confirm or Cancel action is currently in progress. It can be 'confirm', 'cancel', or null (no action in progress). This state is used to disable the buttons and show a loading indicator while the action is being processed.
  const [busy, setBusy] = useState<'confirm' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auth-aware behavior (Stage 17 Phase 2). Anonymous users can propose and
  // discard PROPOSED bookings, but Confirm is gated: clicking it while
  // signed out kicks off the Google OAuth flow with a callbackUrl back to
  // this page. After sign-in, the user re-triggers Confirm.
  const currentUser = useCurrentUser();

  // Post-OAuth resume UX (Stage 17 Phase 3.5). If the URL carries
  // `?confirm=<this-booking's-id>` — i.e. we're on `/?confirm=<id>` right
  // after the Google round-trip, waiting for AnonChatResumeHandler to
  // fire its parallel POSTs — treat this card as if the user just
  // clicked Confirm: disable both buttons, spinner on Confirm. Without
  // this, the card sits with active buttons for the whole 3-4s
  // parallel-POST window, and a user might click Confirm again and
  // trigger the whole OAuth loop a second time.
  const searchParams = useSearchParams();

  // oauthConfirmInFlight is true if the booking status is PROPOSED and the search params contain a confirm query parameter that matches the booking id. This indicates that the user has just completed the OAuth flow and is waiting for the AnonChatResumeHandler to complete the confirmation process. In this case, we disable both buttons and show a spinner on the Confirm button to indicate that the action is in progress.
  const oauthConfirmInFlight =
    booking.status === 'PROPOSED' &&
    searchParams.get('confirm') === String(booking.id);

  // What this effect does, in plain English (Stage 17 Phase 3.5):
  //
  // When the card first mounts and the booking is still PROPOSED, try
  // to bring its status up to date. Terminal states (PAID, CANCELLED)
  // can never change, so we do nothing in those cases.
  //
  // There are two ways to update:
  //
  //   1. FAST — check sessionStorage. If the user just came back from
  //      OAuth via the "click Confirm while anon → sign in" flow, then
  //      AnonChatResumeHandler already called the confirm endpoint on
  //      the previous page and left the fresh PAID booking in
  //      sessionStorage for us. Read it, apply it, clear it, done.
  //      No network call, no visible flicker from PROPOSED → PAID.
  //
  //   2. SLOW — no sessionStorage entry, so ask the server: GET
  //      /api/booking/[id]. Handles the general "we're looking at a
  //      stale snapshot" case: the page was reloaded much later,
  //      another tab confirmed the same booking, etc.
  //
  // If the GET fails or errors out we just keep showing the snapshot
  // we already have — no user-visible failure.
  //
  // About that odd-looking setState in the slow path:
  //
  //   setBooking((prev) => (prev.status === 'PROPOSED' ? fresh : prev))
  //
  // Why not just `setBooking(fresh)`? Because there's a race we have
  // to defend against. Our GET here can happen at the same time as a
  // separate confirm POST fired by PostSignInConfirmHandler (its
  // fallback code path — see that file for the edge case). Two
  // requests, two responses, arriving in either order. If the confirm
  // POST wins the race and flips the local state to PAID via a
  // `booking-updated` event, but our GET response comes back LAST and
  // still says PROPOSED (because the server read the DB just before
  // the confirm POST committed), a naive setBooking(fresh) would
  // clobber PAID back to PROPOSED — the card would look like it
  // un-confirmed itself.
  //
  // The functional form reads whatever `booking.status` IS at the
  // moment of the update, and refuses to overwrite anything that's
  // no longer PROPOSED. Now the order the responses arrive in
  // doesn't matter — PAID always wins.
  useEffect(() => {
    if (booking.status !== 'PROPOSED') return;

    // FAST path: check sessionStorage for a pre-confirmed booking. If found, apply it and clear the key so we don't re-apply it on a hard refresh. This avoids a network call and a visible flicker from PROPOSED → PAID.
    const preconfirmed = readPendingConfirmedBooking(booking.id);
    if (preconfirmed) {
      setBooking(preconfirmed);
      clearPendingConfirmedBooking();
      return;
    }

    // SLOW path: fetch the booking from the server. If it comes back with a different status, apply it. If the fetch fails, we just keep showing the snapshot we already have — no user-visible failure.
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`/api/booking/${booking.id}`);
        if (!res.ok) return;

        const fresh = (await res.json()) as BookingLike;

        if (cancelled || fresh?.id !== booking.id) return;

        setBooking((prev) => (prev.status === 'PROPOSED' ? fresh : prev));
      } catch {
        // Silent — keep showing the snapshot.
      }
    })();
    // Cleanup cancels the fetch if the component unmounts before it completes, to avoid setting state on an unmounted component. This is a common pattern in React to prevent memory leaks and warnings.
    return () => {
      cancelled = true;
    };
    // Only refetch on mount — never on every re-render. If the user
    // interacts with the buttons, callBookingAction already updates
    // state directly from the API response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What this effect does, in plain English (Stage 17 Phase 3.5):
  //
  // Register a `booking-updated` listener on `window`. If some other
  // component in the app dispatches that event with a booking payload
  // whose id matches THIS card's id, we swap our local state for the
  // payload — the card re-renders with the new status (typically PAID
  // after a confirm just landed).
  //
  // Who dispatches this event? Right now only PostSignInConfirmHandler,
  // and only on its fallback POST path (the edge case where the user
  // lands on /c/[id]?confirm=<id> directly — bookmarked URL, hand-typed
  // — without going through AnonChatResumeHandler's fast path). That
  // component's confirm POST completes and needs some way to tell any
  // visible BookingCard "your data is stale, here's the fresh version."
  // A window CustomEvent is a lightweight broadcast: no React Context,
  // no shared state, no prop drilling. Same-tab only (window events
  // don't cross tabs), which is exactly the scope we want.
  //
  // On the fast path (the common case), this listener does nothing.
  // AnonChatResumeHandler stashes the confirmed booking in sessionStorage
  // and the effect above consumes it directly — no event fires.
  //
  // Cleanup removes the listener on unmount or when booking.id changes,
  // so we don't leak stale listeners.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Handler for the booking-updated event. If the event's detail has an id that matches this card's booking id, we update the local booking state with the new data. This allows other components to broadcast booking updates to all relevant BookingCard instances.
    function handler(e: Event) {
      const custom = e as CustomEvent<BookingLike>;
      // custom.detail is the updated booking data. We check if its id matches this card's booking id, and if so, we update the local state. This ensures that only the relevant card updates itself, and not all cards on the page.
      if (custom.detail?.id === booking.id) {
        setBooking(custom.detail);
      }
    }

    window.addEventListener('booking-updated', handler);

    return () => window.removeEventListener('booking-updated', handler);
  }, [booking.id]);

  // Call the booking action API endpoint with the booking id and action (confirm or cancel). The API returns the updated booking data, which we use to update the booking state. If the API returns an error, we throw an error to be caught in the catch block.
  async function callBookingAction(action: 'confirm' | 'cancel') {
    if (action === 'confirm' && !currentUser) {
      // Kick off OAuth. Encode the pending booking id in the callback URL
      // so PostSignInConfirmHandler can auto-complete the confirmation
      // after sign-in — otherwise the chat state (and the BookingCard) is
      // gone and the user would have to re-do the whole flow to confirm.
      const callbackUrl = `/?confirm=${booking.id}`;
      void signInWithGoogle(callbackUrl);
      return;
    }

    setBusy(action);
    setError(null);
    try {
      // We call the booking action API endpoint with the booking id and action (confirm or cancel). The API returns the updated booking data, which we use to update the booking state. If the API returns an error, we throw an error to be caught in the catch block.
      const res = await fetch(`/api/booking/${booking.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = (await res.json()) as BookingLike & {
        // The API may return an error message in the body if the action fails. We check for this and throw an error if present. The error message is displayed in the card below the total price.
        error?: string;
        // code is an optional field that may be returned by the API to indicate a specific error code. We don't use it in the UI, but it may be useful for debugging or logging purposes.
        code?: string;
      };
      if (!res.ok) {
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setBooking(body);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const isProposed = booking.status === 'PROPOSED';
  const isPaid = booking.status === 'PAID';
  const isCancelled = booking.status === 'CANCELLED';

  return (
    <Card variant="outlined" sx={{ mt: 0.5 }}>
      <CardHeader
        title={
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
              {booking.reference}
            </Typography>
            <Chip
              label={booking.status}
              size="small"
              color={statusChipColor(booking.status)}
              variant={isProposed ? 'outlined' : 'filled'}
            />
          </Stack>
        }
        // The subheader shows the customer name and email if available. If both are present, they are separated by a dot. If neither is present, it shows a placeholder message indicating that the guest identity is set at Confirm time.
        subheader={
          booking.customerName || booking.customerEmail
            ? `${booking.customerName ?? ''}${booking.customerName && booking.customerEmail ? ' · ' : ''}${booking.customerEmail ?? ''}`
            : 'Guest identity is set at Confirm'
        }
        sx={{ pb: 1 }}
      />
      <CardContent sx={{ pt: 0, pb: 1 }}>
        {booking.flightBookings.length > 0 && (
          <Box sx={{ mb: booking.hotelBookings.length > 0 ? 1.5 : 0 }}>
            <Stack
              direction="row"
              alignItems="center"
              spacing={0.5}
              sx={{ mb: 0.5 }}
            >
              <FlightIcon fontSize="small" color="action" />
              <Typography variant="subtitle2">Flights</Typography>
            </Stack>
            <FlightLegRows legs={booking.flightBookings} />
          </Box>
        )}

        {booking.hotelBookings.length > 0 && (
          <Box>
            <Stack
              direction="row"
              alignItems="center"
              spacing={0.5}
              sx={{ mb: 0.5 }}
            >
              <HotelIcon fontSize="small" color="action" />
              <Typography variant="subtitle2">Hotels</Typography>
            </Stack>
            <HotelStayRows stays={booking.hotelBookings} />
          </Box>
        )}

        <Divider sx={{ my: 1 }} />
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="subtitle2">Total</Typography>
          <Typography variant="subtitle2">
            {formatEUR(booking.totalPriceEUR)}
          </Typography>
        </Stack>

        {booking.cancellationReason && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: 1, display: 'block' }}
          >
            Cancellation reason: {booking.cancellationReason}
          </Typography>
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
      </CardContent>
      {(isProposed || isPaid) && (
        <CardActions sx={{ pt: 0, pb: 1, px: 2 }}>
          {isProposed && (
            <Button
              variant="contained"
              size="small"
              startIcon={
                // Show a spinner on the Confirm button if the action is in progress (busy === 'confirm') or if we're waiting for the AnonChatResumeHandler to complete the confirmation process (oauthConfirmInFlight). Otherwise, show a check circle icon.
                busy === 'confirm' || oauthConfirmInFlight ? (
                  <CircularProgress size={14} color="inherit" />
                ) : (
                  <CheckCircleIcon />
                )
              }
              disabled={busy !== null || oauthConfirmInFlight}
              onClick={() => callBookingAction('confirm')}
            >
              Confirm
            </Button>
          )}
          <Button
            variant="outlined"
            size="small"
            color={isPaid ? 'warning' : 'primary'}
            startIcon={
              busy === 'cancel' ? (
                <CircularProgress size={14} />
              ) : (
                <CancelIcon />
              )
            }
            disabled={busy !== null || oauthConfirmInFlight}
            onClick={() => callBookingAction('cancel')}
          >
            {isProposed ? 'Cancel' : 'Cancel booking'}
          </Button>
        </CardActions>
      )}
      {isCancelled && (
        <CardActions sx={{ pt: 0, pb: 1, px: 2 }}>
          <Chip
            icon={<CancelIcon fontSize="small" />}
            label="Cancelled"
            size="small"
            variant="outlined"
          />
        </CardActions>
      )}
    </Card>
  );
}
