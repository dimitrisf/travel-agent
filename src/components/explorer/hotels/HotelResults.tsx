import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { HotelCard } from './HotelCard';
import type { HotelResult } from '@/lib/services/HotelService';

// Pretty view for a HotelResult[]. One HotelCard per result, stacked
// vertically. Shows "no matches" when the array is empty (the API
// returned successfully but nothing matched the filters).

export type HotelResultsProps = {
  data: HotelResult[];
};

export function HotelResults({ data }: HotelResultsProps) {
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
        <HotelCard key={h.room_type_id} hotel={h} />
      ))}
    </Stack>
  );
}
