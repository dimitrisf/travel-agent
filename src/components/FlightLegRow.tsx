'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { BookingLike } from '@/types/booking';
import { formatDT, formatEUR } from '@/utils/format';

// A single flight leg row inside a BookingCard.
// each leg is a flight instance + cabin class + seats + price, so we can render it in a single row.
// E.g., "Aegean · A3 123 — ATH → BER, Fri 1 Sep 14:30 → Fri 1 Sep 16:15, Economy, 2 seats, €350.00"
// The FlightLegRow component takes a flight booking leg as a prop and renders it in a Box with two Typography elements: one for the flight details and one for the timing, cabin class, seats, and price.
// The type BookingLike['flightBookings'][number] means that the leg prop is one of the elements of the flightBookings array in a BookingLike object. This allows us to access the flightInstance, cabinClass, seats, and totalPriceEUR properties of the leg.
export function FlightLegRow({
  leg,
}: {
  leg: BookingLike['flightBookings'][number];
}) {
  // We use the flight definition to get the airline, flight number, origin and destination airports, and the flight instance to get the departure and arrival datetimes. We also display the cabin class, number of seats, and total price in EUR.
  const fi = leg.flightInstance;
  const fd = fi.flightDefinition;
  return (
    <Box>
      <Typography variant="body2">
        {fd.airline.name} · {fd.airline.iataCode} {fd.flightNumber} —{' '}
        {fd.originAirport.iataCode} → {fd.destinationAirport.iataCode}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {formatDT(fi.departureDatetime)} → {formatDT(fi.arrivalDatetime)} ·{' '}
        {leg.cabinClass} · {leg.seats} seat{leg.seats > 1 ? 's' : ''} ·{' '}
        {formatEUR(leg.totalPriceEUR)}
      </Typography>
    </Box>
  );
}
