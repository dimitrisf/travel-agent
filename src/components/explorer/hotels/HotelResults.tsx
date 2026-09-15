import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { HotelCard } from './HotelCard';
import type { HotelResult } from '@/lib/services/HotelService';

// Pretty view for a HotelResult[]. Groups the flat (hotel, room_type)
// rows the API returns by hotel_id and renders one HotelCard per
// unique hotel with its room types nested underneath. Shows "no
// matches" when the array is empty (the API returned successfully but
// nothing matched the filters).
//
// `stay` is the query context from the last successful search
// (checkin/checkout/guests/rooms) — snapshotted by the parent page at
// submit time and forwarded down so each RoomRow inside a HotelCard
// can build a selection payload without re-reading the current form
// state.

export type StayContext = {
  checkin: string;
  checkout: string;
  guests: number;
  rooms: number;
};

export type HotelResultsProps = {
  data: HotelResult[];
  stay: StayContext;
};

export function HotelResults({ data, stay }: HotelResultsProps) {
  if (data.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No hotels match those filters.
      </Typography>
    );
  }

  // Group rows by hotel_id, preserving insertion order (the API sorts
  // by price ascending, so the first row of each hotel is its cheapest
  // room — which anchors the group's position in the list). A Map
  // keyed by hotel_id keeps things O(n) with stable ordering.
  //
  // Within each bucket we sort by total_price ascending as a defensive
  // step — the API already delivers rows in that order, but this makes
  // the "rooms are shown cheapest first within a hotel" invariant
  // survive any future secondary-sort change in HotelService.
  const grouped = new Map<number, HotelResult[]>();

  // Initialize the grouping map. Each key is a hotel_id and each value is an array of HotelResult rows for that hotel.
  for (const row of data) {
    const bucket = grouped.get(row.hotel_id);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(row.hotel_id, [row]);
    }
  }

  // Sort each hotel's rooms by total_price ascending to ensure the
  // cheapest room appears first within the hotel.
  for (const bucket of grouped.values()) {
    bucket.sort((a, b) => a.total_price - b.total_price);
  }

  return (
    <Stack spacing={1.5}>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ letterSpacing: '0.14em' }}
      >
        {grouped.size} hotel{grouped.size === 1 ? '' : 's'} · {data.length} room
        {data.length === 1 ? '' : 's'}
      </Typography>

      {Array.from(grouped.entries()).map(([hotelId, rooms]) => (
        <HotelCard key={hotelId} rooms={rooms} stay={stay} />
      ))}
    </Stack>
  );
}
