import { styled } from '@pigment-css/react';
import type { HotelResult } from '@/lib/services/HotelService';
import type { StayContext } from './HotelResults';
import { HotelCardHeader } from './HotelCardHeader';
import { HotelRoomList } from './HotelRoomList';

// One hotel result group: hotel-level info (name, stars, rating,
// address, amenities, cancellation policy) rendered once at the top
// via HotelCardHeader, followed by an expandable list of room types
// via HotelRoomList. This is the grouped-by-hotel presentation — the
// API returns one row per (hotel, room_type), and this component
// composes those into a single card per hotel.
//
// The Add-to-booking toggle lives on each RoomRow (the cart is keyed
// by room_type_id), so per-room selection still works exactly as
// before — only the visual grouping changed.
//
// `stay` reflects the search that produced these rooms (snapshotted
// by the page at submit time), not whatever the form currently shows —
// otherwise the checkin/checkout captured in the selection payload
// would drift from what the user actually saw priced.
//
// Zero-runtime via Pigment CSS: this file has no hooks, handlers, or
// context, so it drops `'use client'` and its styles compile to plain
// CSS at build time — no MUI Emotion runtime for the outer container.
// Its children (HotelCardHeader, HotelRoomList) still opt into 'use
// client' where they need to; a shared component is Client when its
// importer is Client, so the tree keeps working under the current
// client-first page shell without any change to behavior.

// Reproduces MUI's <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.100' }}>
// with the theme's CSS variables so the visual stays aligned with the
// rest of the app. `color` is set explicitly (rather than relying on
// inheritance) to match MUI Paper, which sets it on the root.
const CardRoot = styled('div')({
  padding: '16px',
  backgroundColor: 'var(--mui-palette-grey-100)',
  color: 'var(--mui-palette-text-primary)',
  border: '1px solid var(--mui-palette-divider)',
  borderRadius: '4px',
});

// Reproduces <Stack spacing={1}> — flex column with 8px gap.
const Column = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
});

// Reproduces <Divider sx={{ mt: 1 }}> — 1px hairline drawn on
// border-bottom to match MUI's Divider (which uses
// `border-bottom-width: thin` on an <hr>), with `flex-shrink: 0` for
// the same "don't collapse under pressure" guarantee. The 8px top
// margin combines with the Column's 8px gap for a total 16px of
// visual space above the rule.
const Rule = styled('hr')({
  border: 0,
  borderBottom: '1px solid var(--mui-palette-divider)',
  flexShrink: 0,
  margin: 0,
  marginTop: '8px',
});

export type HotelCardProps = {
  rooms: HotelResult[];
  stay: StayContext;
};

export function HotelCard({ rooms, stay }: HotelCardProps) {
  // All rooms in `rooms` share the same hotel_id, so hotel-level
  // fields (name, address, rating, cancellation, amenities) come from
  // the first row. HotelService guarantees the shape.
  const head = rooms[0];

  return (
    <CardRoot>
      <Column>
        <HotelCardHeader head={head} />
        <Rule />
        <HotelRoomList rooms={rooms} stay={stay} />
      </Column>
    </CardRoot>
  );
}
