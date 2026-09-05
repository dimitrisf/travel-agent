'use client';

import Link from 'next/link';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import FlightIcon from '@mui/icons-material/Flight';
import HotelIcon from '@mui/icons-material/Hotel';
import { formatEUR } from '@/utils/format';
import { useSelection } from '@/context/SelectionContext';

// Sticky bar visible on every /explorer page. Reads the SelectionContext
// (flight + hotel cart) and renders "Selected: X · Y · €total  [Go to
// booking →]". Hidden when the cart is empty so it doesn't take up
// vertical space on the search-first happy path.
//
// The "Go to booking →" link points to /explorer/booking, which the
// next slice will build; until then the link 404s. That's the deliberate
// slice-1 boundary — the wiring proves out first.

export function SelectionBar() {
  const { flight, hotel, clearAll } = useSelection();
  if (!flight && !hotel) return null;

  const total = (flight?.totalEUR ?? 0) + (hotel?.totalEUR ?? 0);

  return (
    <Paper
      variant="outlined"
      role="region"
      aria-label="Booking selection"
      sx={{
        p: 1.5,
        borderColor: 'primary.main',
        borderStyle: 'solid',
        bgcolor: 'primary.50',
      }}
    >
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        alignItems={{ sm: 'center' }}
        justifyContent="space-between"
      >
        <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
          {flight && (
            <Stack direction="row" spacing={1} alignItems="center">
              <FlightIcon fontSize="small" color="action" />
              <Typography
                variant="body2"
                sx={{ fontWeight: 600, minWidth: 0, wordBreak: 'break-word' }}
              >
                {flight.label}
              </Typography>
            </Stack>
          )}
          {hotel && (
            <Stack direction="row" spacing={1} alignItems="center">
              <HotelIcon fontSize="small" color="action" />
              <Typography
                variant="body2"
                sx={{ fontWeight: 600, minWidth: 0, wordBreak: 'break-word' }}
              >
                {hotel.label}
              </Typography>
            </Stack>
          )}
          <Typography variant="caption" color="text.secondary">
            Total {formatEUR(total)}
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1}>
          <Button
            variant="text"
            size="small"
            startIcon={<CloseIcon />}
            onClick={clearAll}
          >
            Clear
          </Button>
          <Button
            variant="contained"
            size="small"
            endIcon={<ArrowForwardIcon />}
            component={Link}
            href="/explorer/booking"
          >
            Go to booking
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
