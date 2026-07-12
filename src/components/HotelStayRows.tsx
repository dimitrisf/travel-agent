'use client';

import Stack from '@mui/material/Stack';
import type { BookingLike } from '@/types/booking';
import { HotelStayRow } from './HotelStayRow';

// A vertical stack of HotelStayRow entries — one per stay. Rendered inside
// the "Hotels" section of a BookingCard.
export function HotelStayRows({
  stays,
}: {
  stays: BookingLike['hotelBookings'];
}) {
  return (
    <Stack spacing={1}>
      {stays.map((hb) => (
        <HotelStayRow key={hb.id} stay={hb} />
      ))}
    </Stack>
  );
}
