import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { HotelCard } from './HotelCard';
import type { HotelResult } from '@/lib/services/HotelService';

// Pretty view for a HotelResult[]. One HotelCard per result, stacked
// vertically. Shows "no matches" when the array is empty (the API
// returned successfully but nothing matched the filters).
//
// `stay` is the query context from the last successful search
// (checkin/checkout/guests/rooms) — snapshotted by the parent page at
// submit time and forwarded down so each HotelCard can build a
// selection payload without re-reading the current form state.

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
  return (
    <Stack spacing={1.5}>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ letterSpacing: '0.14em' }}
      >
        {data.length} hotel{data.length === 1 ? '' : 's'}
      </Typography>
      {data.map((h) => (
        <HotelCard key={h.room_type_id} hotel={h} stay={stay} />
      ))}
    </Stack>
  );
}
