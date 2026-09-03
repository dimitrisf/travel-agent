'use client';

import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { CitySelect } from '@/components/explorer/widgets/CitySelect';
import { NumberStepper } from '@/components/explorer/widgets/NumberStepper';
import { PriceSlider } from '@/components/explorer/widgets/PriceSlider';
import { StarsSelect } from '@/components/explorer/widgets/StarsSelect';
import { SubmitBar } from '@/components/explorer/SubmitBar';
import { buildHotelsQuery } from '@/lib/explorer/hotels/buildQuery';
import { todayLocalIsoDate } from '@/lib/explorer/today';
import { usePersistedState } from '@/lib/explorer/usePersistedState';

// Self-contained search form for /api/hotels. Owns every input field
// (persisted via sessionStorage so Explorer↔Assistant navigation keeps
// the query intact) and the checkout-after-checkin validation. Emits a
// built query URL when the user clicks Search.

export type HotelSearchFormProps = {
  submitting: boolean;
  onSearch: (args: { path: string }) => void;
};

export function HotelSearchForm({
  submitting,
  onSearch,
}: HotelSearchFormProps) {
  const [city, setCity] = usePersistedState('explorer:hotels:city', 'Athens');

  const [checkin, setCheckin] = usePersistedState(
    'explorer:hotels:checkin',
    '',
  );

  const [checkout, setCheckout] = usePersistedState(
    'explorer:hotels:checkout',
    '',
  );

  const [guests, setGuests] = usePersistedState('explorer:hotels:guests', 2);

  const [rooms, setRooms] = usePersistedState('explorer:hotels:rooms', 1);

  const [minStars, setMinStars] = usePersistedState<number | undefined>(
    'explorer:hotels:minStars',
    undefined,
  );

  const [maxPrice, setMaxPrice] = usePersistedState<number | undefined>(
    'explorer:hotels:maxPrice',
    undefined,
  );

  const [breakfastRequired, setBreakfastRequired] = usePersistedState(
    'explorer:hotels:breakfastRequired',
    false,
  );

  const [freeCancellation, setFreeCancellation] = usePersistedState(
    'explorer:hotels:freeCancellation',
    false,
  );

  const [petFriendly, setPetFriendly] = usePersistedState(
    'explorer:hotels:petFriendly',
    false,
  );

  // Checkout must be strictly after checkin (matches the server's zod
  // validation, which returns INVALID_DATE_RANGE otherwise). Only
  // enforce when both dates are set — an empty date is not an error,
  // it's just an incomplete form.
  const invalidDateRange =
    checkin.length > 0 && checkout.length > 0 && checkout <= checkin;

  const today = todayLocalIsoDate();

  // Past-date guard: sessionStorage rehydrates whatever dates were last
  // typed, so a stored value can silently become "past" once the day
  // rolls over. The `min` attribute only constrains the picker UI, not
  // the value that's already sitting in state, so we have to check
  // here as well. Empty is fine (incomplete form, not invalid).
  const hasPastDate =
    (checkin.length > 0 && checkin < today) ||
    (checkout.length > 0 && checkout < today);

  const path = buildHotelsQuery({
    city,
    checkin,
    checkout,
    guests,
    rooms,
    minStars,
    maxPrice,
    breakfastRequired,
    freeCancellation,
    petFriendly,
  });

  function handleSubmit() {
    if (invalidDateRange || hasPastDate) return;
    onSearch({ path });
  }

  return (
    <>
      <Stack spacing={2.5} sx={{ mt: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <CitySelect value={city} onChange={setCity} width={170} />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Check-in"
            type="date"
            value={checkin}
            onChange={(e) => setCheckin(e.target.value)}
            size="small"
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { min: today },
            }}
            sx={{ maxWidth: 200 }}
          />
          <TextField
            label="Check-out"
            type="date"
            value={checkout}
            onChange={(e) => setCheckout(e.target.value)}
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
          <NumberStepper
            label="Guests"
            value={guests}
            onChange={setGuests}
            min={1}
            max={9}
          />
          <NumberStepper
            label="Rooms"
            value={rooms}
            onChange={setRooms}
            min={1}
            max={5}
          />
          <StarsSelect value={minStars} onChange={setMinStars} />
        </Stack>

        <PriceSlider
          label="Max price per night"
          value={maxPrice}
          onChange={setMaxPrice}
          max={1000}
          defaultValue={200}
        />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={breakfastRequired}
                onChange={(e) => setBreakfastRequired(e.target.checked)}
              />
            }
            label="Breakfast required"
            sx={{ ml: 0 }}
          />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={freeCancellation}
                onChange={(e) => setFreeCancellation(e.target.checked)}
              />
            }
            label="Free cancellation"
            sx={{ ml: 0 }}
          />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={petFriendly}
                onChange={(e) => setPetFriendly(e.target.checked)}
              />
            }
            label="Pet friendly"
            sx={{ ml: 0 }}
          />
        </Stack>
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

      {invalidDateRange && (
        <Typography
          variant="caption"
          color="error"
          sx={{ mt: 2, display: 'block' }}
        >
          Check-out must be after check-in.
        </Typography>
      )}

      <SubmitBar
        submitLabel="Search hotels"
        onSubmit={handleSubmit}
        submitting={submitting || invalidDateRange || hasPastDate}
        curl={{ method: 'GET', path }}
      />
    </>
  );
}
