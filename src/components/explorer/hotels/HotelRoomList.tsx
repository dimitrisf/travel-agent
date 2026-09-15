'use client';

import { useState } from 'react';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import type { HotelResult } from '@/lib/services/HotelService';
import type { StayContext } from './HotelResults';
import { RoomRow } from './RoomRow';

// The summary line + chevron toggle + collapsible list of room rows
// for one hotel. Owns its own expand/collapse state so each card in
// a HotelResults page toggles independently — no parent has to track
// expand state for the whole list.
//
// Extracted from HotelCard so the "identity + policy" block (see
// HotelCardHeader) and the "list of bookable rooms" block are
// separate concerns. HotelCard now just composes them.
//
// `rooms` is assumed sorted cheapest first (HotelResults enforces
// this per bucket), so rooms[0] is used both for the hotel-name
// aria-label and for the "from €X" summary price.

export type HotelRoomListProps = {
  rooms: HotelResult[];
  stay: StayContext;
};

export function HotelRoomList({ rooms, stay }: HotelRoomListProps) {
  // Expanded by default — all room types are visible on load, so the
  // information density matches what the user's used to. The chevron
  // lets them collapse a card once they've decided it's not their
  // pick, cleaning up the list without losing the count/from-price
  // summary above.
  const [expanded, setExpanded] = useState(true);

  const head = rooms[0];
  const symbol = head.currency === 'EUR' ? '€' : `${head.currency} `;

  return (
    <>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mt: 0.5 }}
      >
        <Typography variant="body2" color="text.secondary">
          {rooms.length} room type{rooms.length === 1 ? '' : 's'} · from{' '}
          {symbol}
          {head.total_price}
        </Typography>
        <IconButton
          size="small"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? `Hide room types for ${head.hotel}`
              : `Show room types for ${head.hotel}`
          }
        >
          {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </IconButton>
      </Stack>

      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Stack spacing={1} sx={{ mt: 0.5 }}>
          {rooms.map((room) => (
            <RoomRow key={room.room_type_id} room={room} stay={stay} />
          ))}
        </Stack>
      </Collapse>
    </>
  );
}
