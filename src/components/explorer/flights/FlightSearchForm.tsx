'use client';

import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { AirportSelect } from '@/components/explorer/widgets/AirportSelect';
import { NumberStepper } from '@/components/explorer/widgets/NumberStepper';
import { PriceSlider } from '@/components/explorer/widgets/PriceSlider';
import { SubmitBar } from '@/components/explorer/SubmitBar';
import { buildFlightsQuery } from '@/lib/explorer/flights/buildQuery';
import { todayLocalIsoDate } from '@/lib/explorer/today';
import { usePersistedState } from '@/lib/explorer/usePersistedState';
import { CabinClass } from '@/lib/pricing';

// Self-contained search form for /api/flights. Owns every input field
// (persisted via sessionStorage so Explorer↔Assistant navigation keeps
// the query intact) and the same-airport validation. The parent stays
// oblivious to the field-level state and just receives a fully-built
// query URL plus the passenger count when the user clicks Search.

export type FlightSearchFormProps = {
  submitting: boolean;
  onSearch: (args: { path: string; passengers: number }) => void;
};

export function FlightSearchForm({
  submitting,
  onSearch,
}: FlightSearchFormProps) {
  const [origin, setOrigin] = usePersistedState(
    'explorer:flights:origin',
    'ATH',
  );

  const [destination, setDestination] = usePersistedState(
    'explorer:flights:destination',
    'BER',
  );

  const [departureDate, setDepartureDate] = usePersistedState(
    'explorer:flights:departureDate',
    '',
  );

  const [returnDate, setReturnDate] = usePersistedState(
    'explorer:flights:returnDate',
    '',
  );

  const [cabinClass, setCabinClass] = usePersistedState<CabinClass>(
    'explorer:flights:cabinClass',
    'economy',
  );

  const [adults, setAdults] = usePersistedState('explorer:flights:adults', 1);

  const [children, setChildren] = usePersistedState(
    'explorer:flights:children',
    0,
  );

  const [nonstopOnly, setNonstopOnly] = usePersistedState(
    'explorer:flights:nonstopOnly',
    false,
  );

  const [maxPrice, setMaxPrice] = usePersistedState<number | undefined>(
    'explorer:flights:maxPrice',
    undefined,
  );

  // Same-airport check: covers both dropdown selection (blocked by
  // excludeIata on the widget) AND free-typed IATAs that still slip
  // through. Compared case-insensitively since the server upper-cases.
  const sameAirport =
    origin.trim().length > 0 &&
    destination.trim().length > 0 &&
    origin.trim().toUpperCase() === destination.trim().toUpperCase();

  const today = todayLocalIsoDate();

  // Past-date guard: sessionStorage rehydrates whatever dates were last
  // typed, so a stored value can silently become "past" once the day
  // rolls over. The `min` attribute only constrains the picker UI, not
  // the value that's already sitting in state, so we have to check
  // here as well. Empty is fine (return is optional; departure is
  // incomplete-not-invalid).
  const hasPastDate =
    (departureDate.length > 0 && departureDate < today) ||
    (returnDate.length > 0 && returnDate < today);

  const path = buildFlightsQuery({
    origin,
    destination,
    departureDate,
    returnDate,
    cabinClass,
    adults,
    children,
    nonstopOnly,
    maxPrice,
  });

  function handleSubmit() {
    if (sameAirport || hasPastDate) return;
    onSearch({ path, passengers: adults + children });
  }

  return (
    <>
      <Stack spacing={2.5} sx={{ mt: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <AirportSelect
            value={origin}
            onChange={setOrigin}
            label="Origin"
            excludeIata={destination}
          />
          <AirportSelect
            value={destination}
            onChange={setDestination}
            label="Destination"
            excludeIata={origin}
          />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Departure"
            type="date"
            value={departureDate}
            onChange={(e) => setDepartureDate(e.target.value)}
            size="small"
            // Ensure the label shrinks when a date is selected.
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { min: today },
            }}
            sx={{ maxWidth: 200 }}
          />
          <TextField
            label="Return (optional)"
            type="date"
            value={returnDate}
            onChange={(e) => setReturnDate(e.target.value)}
            size="small"
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { min: today },
            }}
            sx={{ maxWidth: 200 }}
          />
        </Stack>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ sm: 'flex-end' }}
        >
          <TextField
            select
            label="Cabin"
            value={cabinClass}
            onChange={(e) => setCabinClass(e.target.value as CabinClass)}
            size="small"
            sx={{ minWidth: 160 }}
          >
            {CabinClass.options.map((c) => (
              <MenuItem key={c} value={c}>
                {c.replace('_', ' ')}
              </MenuItem>
            ))}
          </TextField>
          <NumberStepper
            label="Adults"
            value={adults}
            onChange={setAdults}
            min={1}
            max={9}
          />
          <NumberStepper
            label="Children"
            value={children}
            onChange={setChildren}
            min={0}
            max={9}
          />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={nonstopOnly}
                onChange={(e) => setNonstopOnly(e.target.checked)}
              />
            }
            label="Direct only"
            // Align the label with the switch control.
            sx={{ ml: 0 }}
          />
        </Stack>

        <PriceSlider
          label="Max price"
          value={maxPrice}
          onChange={setMaxPrice}
        />
      </Stack>

      {hasPastDate && (
        <Typography
          variant="caption"
          color="error"
          sx={{ mt: 2, display: 'block' }}
        >
          Dates cannot be in the past.
        </Typography>
      )}

      {sameAirport && (
        <Typography
          variant="caption"
          color="error"
          sx={{ mt: 2, display: 'block' }}
        >
          Origin and destination must be different airports.
        </Typography>
      )}

      <SubmitBar
        submitLabel="Search flights"
        onSubmit={handleSubmit}
        submitting={submitting || sameAirport || hasPastDate}
        curl={{ method: 'GET', path }}
      />
    </>
  );
}
