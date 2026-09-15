'use client';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Rating from '@mui/material/Rating';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { HotelResult } from '@/lib/services/HotelService';

// Hotel-level info block for HotelCard: name + stars + rating on the
// first row, then address, amenity chips, and cancellation policy.
// Extracted from HotelCard so the "identity + policy" of a hotel is
// separable from the room-list mechanics (expand/collapse, per-room
// pricing, cart toggles) that live in HotelCard proper.
//
// Fields are pulled from `head` — the first HotelResult in a group.
// Since all rooms in a group share the same hotel_id, hotel-level
// data is identical across the group and taking it from the first
// row is safe (HotelService guarantees the shape).

export type HotelCardHeaderProps = {
  head: HotelResult;
};

export function HotelCardHeader({ head }: HotelCardHeaderProps) {
  return (
    <>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          {head.hotel}
        </Typography>
        <Rating value={head.stars} readOnly size="small" />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {head.rating.toFixed(1)} / 10
        </Typography>
      </Stack>

      <Typography variant="body2" color="text.secondary">
        {head.address}
      </Typography>

      {head.amenities.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
          {head.amenities.map((a) => (
            <Chip
              key={a}
              label={a}
              size="small"
              variant="outlined"
              // background.paper (#fff in the light theme) lifts each
              // chip off the card's grey.100 surface — grey.50 was
              // too close in value to read as a distinct pill.
              sx={{ bgcolor: 'background.paper' }}
            />
          ))}
        </Box>
      )}

      <Typography
        variant="caption"
        color={head.free_cancellation ? 'success.main' : 'text.secondary'}
      >
        {head.cancellation_description}
      </Typography>
    </>
  );
}
