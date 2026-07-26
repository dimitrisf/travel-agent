'use client';

import { useState } from 'react';
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
                busy === 'confirm' ? (
                  <CircularProgress size={14} color="inherit" />
                ) : (
                  <CheckCircleIcon />
                )
              }
              disabled={busy !== null}
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
            disabled={busy !== null}
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
