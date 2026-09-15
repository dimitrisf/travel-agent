'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import FlightLandIcon from '@mui/icons-material/FlightLand';
import HotelIcon from '@mui/icons-material/Hotel';
import { formatEUR } from '@/utils/format';
import { useSelection } from '@/context/SelectionContext';
import { SelectionLine } from './SelectionLine';

// Sticky bar visible on every /explorer page. Reads the SelectionContext
// (outbound flight + inbound flight + hotel cart) and renders one line
// per selection with an appropriate icon, sums totals, and offers Clear
// + "Go to booking" buttons. Hidden when the cart is empty so it doesn't
// take up vertical space on the search-first happy path.
//
// The "Go to booking →" link points to /explorer/booking (the page
// that consumes this cart and calls propose_booking).

export function SelectionBar() {
  const { outboundFlight, inboundFlight, hotel, clearAll } = useSelection();
  const pathname = usePathname();
  if (!outboundFlight && !inboundFlight && !hotel) return null;

  // Hide the "Go to booking" affordance when the user is already on
  // the booking page — otherwise it looks like a still-actionable
  // link that does nothing on click.
  const onBookingPage = pathname === '/explorer/booking';

  const total =
    (outboundFlight?.totalEUR ?? 0) +
    (inboundFlight?.totalEUR ?? 0) +
    (hotel?.totalEUR ?? 0);

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
          {outboundFlight && (
            <SelectionLine
              icon={<FlightTakeoffIcon fontSize="small" color="action" />}
              labelPrefix="Outbound"
              label={outboundFlight.label}
              priceEUR={outboundFlight.totalEUR}
            />
          )}
          {inboundFlight && (
            <SelectionLine
              icon={<FlightLandIcon fontSize="small" color="action" />}
              labelPrefix="Return"
              label={inboundFlight.label}
              priceEUR={inboundFlight.totalEUR}
            />
          )}
          {hotel && (
            <SelectionLine
              icon={<HotelIcon fontSize="small" color="action" />}
              labelPrefix="Hotel"
              label={hotel.label}
              priceEUR={hotel.totalEUR}
            />
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
          {!onBookingPage && (
            <Button
              variant="contained"
              size="small"
              endIcon={<ArrowForwardIcon />}
              component={Link}
              href="/explorer/booking"
            >
              Go to booking
            </Button>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}

