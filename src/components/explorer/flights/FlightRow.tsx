import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { FLIGHT_ROW_GRID } from '@/lib/explorer/flights/sort';
import type { FlightResult } from '@/lib/services/FlightService';

// One row in a leg's flight table. Columns are aligned to the shared
// FLIGHT_ROW_GRID so the sortable headers above line up.

export type FlightRowProps = {
  flight: FlightResult;
  passengers: number;
};

export function FlightRow({ flight, passengers }: FlightRowProps) {
  const depTime = flight.departure.slice(11, 16);
  const arrTime = flight.arrival.slice(11, 16);
  const hours = Math.floor(flight.duration_minutes / 60);
  const minutes = flight.duration_minutes % 60;
  // API price is per seat; total = seat × pax. Sort order is unaffected
  // since the multiplier is constant across the leg.
  const total = flight.price * passengers;
  const symbol = flight.currency === 'EUR' ? '€' : `${flight.currency} `;

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: FLIGHT_ROW_GRID,
        gap: 2,
        alignItems: 'baseline',
        py: 0.75,
        borderBottom: 1,
        borderColor: 'divider',
        '&:last-child': { borderBottom: 0 },
      }}
    >
      <Typography variant="body2" fontFamily="monospace">
        {flight.airline} {flight.flight_number}
      </Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {depTime} → {arrTime}
      </Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {hours}h {minutes}m
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="body2" color="text.secondary">
          {flight.origin.iata} – {flight.destination.iata}
        </Typography>
        {flight.stops > 0 && (
          <Chip
            label={`${flight.stops} stop${flight.stops === 1 ? '' : 's'}`}
            size="small"
            variant="outlined"
          />
        )}
      </Stack>
      <Stack alignItems="flex-end" spacing={0}>
        <Typography
          variant="body2"
          sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
        >
          {symbol}
          {total}
        </Typography>
        {passengers > 1 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {symbol}
            {flight.price} × {passengers}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
