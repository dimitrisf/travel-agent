'use client';

import Stack from '@mui/material/Stack';
import type { BookingLike } from '@/types/booking';
import { FlightLegRow } from './FlightLegRow';

// A vertical stack of FlightLegRow entries — one per leg. Rendered inside the
// "Flights" section of a BookingCard.
export function FlightLegRows({
  legs,
}: {
  legs: BookingLike['flightBookings'];
}) {
  return (
    <Stack spacing={1}>
      {legs.map((fb) => (
        <FlightLegRow key={fb.id} leg={fb} />
      ))}
    </Stack>
  );
}
