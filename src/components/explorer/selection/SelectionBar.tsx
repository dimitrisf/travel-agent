'use client';

import { usePathname } from 'next/navigation';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import { useSelection } from '@/context/SelectionContext';
import { SelectionActions } from './SelectionActions';
import { SelectionLines } from './SelectionLines';
import { SelectionTotal } from './SelectionTotal';

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
      {/* This stack contains the selection lines, total, and action buttons */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        alignItems={{ sm: 'center' }}
        justifyContent="space-between"
      >
        {/* This stack contains the selection lines and total, and grows to fill available space */}
        {/* flex: 1 tells a flex child to grow and fill whatever space the parent row has left over — otherwise, by default, flex items only take their content width. minWidth: 0 overrides the flex-child default of min-width: auto, which refuses to let an item shrink below its content size — the common cause of long text blowing out a layout even when it has overflow: hidden. Together they mean "take the leftover space, but shrink gracefully instead of overflowing if the row is cramped." It's the standard idiom for a "primary content column" sitting next to a fixed-size button cluster. */}
        <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
          <SelectionLines
            outboundFlight={outboundFlight}
            inboundFlight={inboundFlight}
            hotel={hotel}
          />
          <SelectionTotal total={total} />
        </Stack>

        <SelectionActions onClear={clearAll} onBookingPage={onBookingPage} />
      </Stack>
    </Paper>
  );
}
