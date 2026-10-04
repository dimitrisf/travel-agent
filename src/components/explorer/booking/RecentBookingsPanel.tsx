'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import RefreshIcon from '@mui/icons-material/Refresh';
import { PanelHeader } from '@/components/explorer/PanelHeader';
import { useCurrentUser } from '@/lib/auth/client';
import { explorerFetch } from '@/lib/explorer/explorerFetch';
import { notLoading, type ResponseState } from '@/lib/explorer/explorerTypes';
import { usePersistedState } from '@/lib/explorer/usePersistedState';
import type { BookingLike } from '@/types/booking';
import { RecentBookingRow } from './RecentBookingRow';

// sessionStorage key for the last-fetched recent-bookings list.
// Cached per tab so a round-trip through another /explorer page and
// back doesn't hit /api/bookings again — the panel hydrates from
// storage instead. Fresh tab or new session starts empty and shows
// the explicit "Load" button. Bumped alongside any breaking change
// to BookingLike so a stale entry doesn't rehydrate as garbage.
const STORAGE_KEY = 'explorer:recentBookings:v1';

// Ledger of the signed-in user's most recent bookings, shown as a
// separate panel below the cart/BookingCard on /explorer/booking.
// Each row summarises one booking (reference + time span + status
// chip + total) and expands into a full BookingCard on chevron click
// — so Confirm/Cancel work on a past booking without leaving the
// page.
//
// Auth-gated. Signed-out users see a compact "Sign in to see your
// bookings" prompt instead of an empty list; "unauthorized" and
// "authenticated with zero bookings" are meaningfully different
// states, so we don't collapse them into one empty UI.
//
// Explicit-load, session-cached: the panel does NOT auto-fetch on
// mount. First-ever visit shows a "Load recent bookings" button so
// the user opts in — a GET /api/bookings request returns a
// fully-included BookingWithRelations[] payload, which is real
// latency we shouldn't pay unprompted. After the first load, the
// list is cached in sessionStorage; navigating away and back to the
// booking page hydrates the panel from cache instead of hitting the
// endpoint again, and a small "Refresh" button gives an explicit
// re-fetch when the user wants fresh data.
//
// Anon PROPOSED bookings (userId=null) are excluded server-side by
// listBookingsForUser — this list is scoped to bookings the current
// user actually owns.

export function RecentBookingsPanel() {
  const currentUser = useCurrentUser();
  // Extracted as a primitive because `useCurrentUser()` returns a
  // fresh object literal on every render — passing `currentUser`
  // into any hook's deps array would make that hook re-fire every
  // render, which in a fetch effect becomes an infinite request
  // loop. A primitive `userId` compares by value, so it stays stable
  // across renders when the signed-in user hasn't changed. It also
  // doubles as a clean signed-in guard inside `load`
  // (`if (!userId) return`).
  const userId = currentUser?.id ?? null;

  // Session-cached across /explorer/* navigation. The `notLoading`
  // filter keeps a mid-flight `{ kind: 'loading' }` snapshot from
  // sneaking into sessionStorage — otherwise a fast browser-close
  // during a fetch would rehydrate the next visit into a stuck
  // spinner.
  const [state, setState] = usePersistedState<ResponseState<BookingLike[]>>(
    STORAGE_KEY,
    { kind: 'idle' },
    notLoading,
  );

  // Fires only when the user clicks Load / Refresh / Retry — never
  // on mount, never on re-render. Guarded on userId so a signed-out
  // click (shouldn't be reachable in the UI but defense in depth)
  // doesn't POST an unauthenticated request.
  async function load() {
    if (!userId) return;

    setState({ kind: 'loading' });

    const next = await explorerFetch<BookingLike[]>({
      method: 'GET',
      path: '/api/bookings',
    });

    setState(next);
  }

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <PanelHeader title="Recent bookings" endpoint="GET /api/bookings" />
      <Box sx={{ mt: 2 }}>
        {!currentUser && (
          <Alert severity="info">Sign in to see your recent bookings.</Alert>
        )}
        {currentUser && state.kind === 'idle' && (
          <Stack alignItems="center" spacing={1.5} sx={{ py: 3 }}>
            <Typography variant="body2" color="text.secondary">
              Load your recent bookings on demand.
            </Typography>
            <Button
              variant="contained"
              size="small"
              startIcon={<CloudDownloadIcon />}
              onClick={load}
            >
              Load recent bookings
            </Button>
          </Stack>
        )}
        {currentUser && state.kind === 'loading' && (
          <Stack alignItems="center" sx={{ py: 3 }}>
            <CircularProgress size={24} />
          </Stack>
        )}
        {currentUser && state.kind === 'error' && (
          <Stack spacing={1}>
            <Alert severity="error">{state.error.message}</Alert>
            <Stack direction="row" justifyContent="flex-end">
              <Button size="small" startIcon={<RefreshIcon />} onClick={load}>
                Retry
              </Button>
            </Stack>
          </Stack>
        )}
        {currentUser && state.kind === 'success' && (
          <Stack spacing={1}>
            {/* Refresh sits at the top, not the bottom, so it's
                findable at a glance regardless of list length. */}
            <Stack direction="row" justifyContent="flex-end">
              <Button
                size="small"
                variant="text"
                startIcon={<RefreshIcon />}
                onClick={load}
              >
                Refresh
              </Button>
            </Stack>
            {state.data.length === 0 ? (
              <Alert severity="info">
                No bookings yet. Ones you propose here or through the assistant
                will appear in this list.
              </Alert>
            ) : (
              state.data.map((booking) => (
                <RecentBookingRow key={booking.id} booking={booking} />
              ))
            )}
          </Stack>
        )}
      </Box>
    </Paper>
  );
}

