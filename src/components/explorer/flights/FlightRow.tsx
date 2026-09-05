'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import AddIcon from '@mui/icons-material/Add';
import {
  isSelectedFlight,
  useSelection,
  type SelectedFlight,
} from '@/context/SelectionContext';
import { FLIGHT_ROW_GRID } from '@/lib/explorer/flights/sort';
import type { CabinClass } from '@/lib/pricing';
import type { FlightResult } from '@/lib/services/FlightService';

// One row in a leg's flight table. Columns are aligned to the shared
// FLIGHT_ROW_GRID so the sortable headers above line up. The trailing
// cell holds the "Add to booking" toggle wired to SelectionContext.
//
// `cabinClass` and `passengers` reflect the search that produced this
// row (snapshotted by the page at submit time), not whatever the form
// currently shows — otherwise the seat price + cabin captured in the
// selection payload would drift from what the user actually saw.

export type FlightRowProps = {
  flight: FlightResult;
  passengers: number;
  cabinClass: CabinClass;
};

export function FlightRow({ flight, passengers, cabinClass }: FlightRowProps) {
  const depTime = flight.departure.slice(11, 16);
  const arrTime = flight.arrival.slice(11, 16);
  const date = flight.departure.slice(0, 10);
  const hours = Math.floor(flight.duration_minutes / 60);
  const minutes = flight.duration_minutes % 60;
  // API price is per seat; total = seat × pax. Sort order is unaffected
  // since the multiplier is constant across the leg.
  const total = flight.price * passengers;
  const symbol = flight.currency === 'EUR' ? '€' : `${flight.currency} `;

  const selection = useSelection();
  const payload: SelectedFlight = {
    flight_instance_id: flight.flight_instance_id,
    cabin_class: cabinClass,
    seats: passengers,
    priceEUR: flight.price,
    totalEUR: total,
    label: `${flight.airline} ${flight.flight_number} · ${flight.origin.iata} → ${flight.destination.iata} · ${date} ${depTime}`,
  };
  const selected = isSelectedFlight(selection, payload);

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
      <Box sx={{ alignSelf: 'center' }}>
        <Button
          size="small"
          variant={selected ? 'contained' : 'outlined'}
          color="primary"
          startIcon={selected ? <CheckIcon /> : <AddIcon />}
          onClick={() => selection.toggleFlight(payload)}
          aria-pressed={selected}
          aria-label={
            selected
              ? `Remove ${payload.label} from booking`
              : `Add ${payload.label} to booking`
          }
        >
          {selected ? 'Selected' : 'Add'}
        </Button>
      </Box>
    </Box>
  );
}
