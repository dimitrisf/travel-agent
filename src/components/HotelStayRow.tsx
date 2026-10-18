'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { BookingLike } from '@/types/booking';
import { formatEUR } from '@/utils/format';
import { useFormatDate } from '@/context/SettingsContext';

// A single hotel stay row inside a BookingCard.
// each stay is a hotel + room type + checkin/checkout + nights + guests + rooms + price, so we can render it in a single row.
export function HotelStayRow({
  stay,
}: {
  stay: BookingLike['hotelBookings'][number];
}) {
  const rt = stay.roomType;
  const hotel = rt.hotel;
  const formatDate = useFormatDate();
  return (
    <Box>
      <Typography variant="body2">
        {hotel.name} · {rt.name} · {hotel.city.name}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {formatDate(stay.checkinDate)} → {formatDate(stay.checkoutDate)} ·{' '}
        {stay.nights} night{stay.nights > 1 ? 's' : ''} · {stay.guests} guest
        {stay.guests > 1 ? 's' : ''}, {stay.rooms} room
        {stay.rooms > 1 ? 's' : ''} · {formatEUR(stay.totalPriceEUR)}
      </Typography>
    </Box>
  );
}
