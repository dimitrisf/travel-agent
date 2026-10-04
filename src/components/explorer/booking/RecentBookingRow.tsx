'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { BookingCard } from '@/components/BookingCard';
import type { BookingLike } from '@/types/booking';
import {
  computeBookingDateRange,
  formatBookingDateRange,
  statusChipColor,
} from '@/utils/booking';
import { formatEUR } from '@/utils/format';

// One row in the ledger: compact summary on top, expandable to a full
// BookingCard below (same component the cart flow renders, so a user
// can Confirm/Cancel any of their own past bookings without leaving
// this page). Per-row expand state so each row toggles independently.
export function RecentBookingRow({ booking }: { booking: BookingLike }) {
  const [expanded, setExpanded] = useState(false);

  const dateRange = computeBookingDateRange(booking);

  return (
    <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'grey.50' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          sx={{ flex: 1, minWidth: 0, flexWrap: 'wrap' }}
        >
          <Typography
            variant="body2"
            sx={{ fontFamily: 'monospace', fontWeight: 500 }}
          >
            {booking.reference}
          </Typography>
          {dateRange && (
            <Typography variant="body2" color="text.secondary">
              {formatBookingDateRange(dateRange.start, dateRange.end)}
            </Typography>
          )}
          <Chip
            label={booking.status}
            size="small"
            color={statusChipColor(booking.status)}
            variant={booking.status === 'PROPOSED' ? 'outlined' : 'filled'}
          />
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {formatEUR(booking.totalPriceEUR)}
          </Typography>
        </Stack>
        <IconButton
          size="small"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? `Hide details for ${booking.reference}`
              : `Show details for ${booking.reference}`
          }
        >
          {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </IconButton>
      </Stack>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Box sx={{ mt: 1.5 }}>
          <BookingCard initialBooking={booking} />
        </Box>
      </Collapse>
    </Paper>
  );
}
