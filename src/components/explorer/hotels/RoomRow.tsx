'use client';

import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import AddIcon from '@mui/icons-material/Add';
import {
  isSelectedHotel,
  useSelection,
  type SelectedHotel,
} from '@/context/SelectionContext';
import type { HotelResult } from '@/lib/services/HotelService';
import type { StayContext } from './HotelResults';

// A single room-type row within a HotelCard: room name + city on the
// left, total and per-night price plus the Add-to-booking toggle on
// the right. Extracted from HotelCard so the hotel-grouped layout
// and its per-room selection concerns are each testable in isolation.
// The shared cart key (room_type_id) means each row can toggle
// independently even though several rows share a hotel_id.

export type RoomRowProps = {
  room: HotelResult;
  stay: StayContext;
};

export function RoomRow({ room, stay }: RoomRowProps) {
  const symbol = room.currency === 'EUR' ? '€' : `${room.currency} `;

  // selection state for this room row
  const selection = useSelection();
  const payload: SelectedHotel = {
    room_type_id: room.room_type_id,
    checkin: stay.checkin,
    checkout: stay.checkout,
    guests: stay.guests,
    rooms: stay.rooms,
    nights: room.nights,
    pricePerNightEUR: room.price_per_night,
    totalEUR: room.total_price,
    label: `${room.hotel} · ${room.room_type}`,
  };
  const selected = isSelectedHotel(selection, payload);

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1}
      alignItems={{ sm: 'center' }}
      justifyContent="space-between"
    >
      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
        {room.room_type} · {room.city}
      </Typography>

      <Stack
        direction="row"
        spacing={1.5}
        alignItems="center"
        sx={{ flexShrink: 0 }}
      >
        <Stack alignItems="flex-end" spacing={0}>
          <Typography
            variant="subtitle2"
            sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
          >
            {symbol}
            {room.total_price}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {symbol}
            {room.price_per_night}/night × {room.nights} night
            {room.nights === 1 ? '' : 's'}
          </Typography>
        </Stack>
        <Button
          size="small"
          variant={selected ? 'contained' : 'outlined'}
          color="primary"
          startIcon={selected ? <CheckIcon /> : <AddIcon />}
          onClick={() => selection.toggleHotel(payload)}
          aria-pressed={selected}
          aria-label={
            selected
              ? `Remove ${payload.label} from booking`
              : `Add ${payload.label} to booking`
          }
          // Lift the un-selected "Add" pill off the card's grey.100
          // surface with a background.paper (#fff in light theme)
          // fill. When selected, MUI's contained + primary already
          // produces a strong filled look, so leave that alone.
          //
          // The explicit hover swap is here because the plain-white
          // base makes MUI's built-in 4% primary-tint hover
          // essentially invisible. `grey.100` matches the card's own
          // surface, giving the pill a clear "settle into the card"
          // hover cue while keeping the un-hovered state distinctly
          // brighter than the card behind it.
          sx={
            !selected
              ? {
                  bgcolor: 'background.paper',
                  '&:hover': { bgcolor: 'grey.100' },
                }
              : undefined
          }
        >
          {selected ? 'Selected' : 'Add'}
        </Button>
      </Stack>
    </Stack>
  );
}
