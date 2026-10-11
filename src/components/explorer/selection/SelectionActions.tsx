import Link from 'next/link';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import CloseIcon from '@mui/icons-material/Close';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';

// Actions column of SelectionBar: Clear (always visible) and "Go to
// booking →" (hidden when the user is already on /explorer/booking,
// since clicking the link there would do nothing — looks broken).
// Props-driven so SelectionBar stays the sole context + pathname
// reader; this component is just the visual arrangement.

type SelectionActionsProps = {
  onClear: () => void;
  // True when the user is already on /explorer/booking — suppresses
  // the "Go to booking" affordance. Phrased as the state rather than
  // a "showGoToBooking" negation so the parent passes the same flag
  // it already has in hand (`pathname === '/explorer/booking'`).
  onBookingPage: boolean;
};

export function SelectionActions({
  onClear,
  onBookingPage,
}: SelectionActionsProps) {
  return (
    <Stack direction="row" spacing={1}>
      <Button
        variant="text"
        size="small"
        startIcon={<CloseIcon />}
        onClick={onClear}
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
  );
}
