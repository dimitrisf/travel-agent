import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { FlightHeaderRow } from './FlightHeaderRow';
import { FlightRow } from './FlightRow';
import type { SortSpec } from '@/lib/explorer/flights/sort';
import type { FlightResult } from '@/lib/services/FlightService';

// One outbound or return leg: overline caption (title · date · count),
// then the sortable header row, then the flight rows.

export type LegBlockProps = {
  title: string;
  flights: FlightResult[];
  passengers: number;
  sort: SortSpec;
  onSort: (sort: SortSpec) => void;
};

export function LegBlock({
  title,
  flights,
  passengers,
  sort,
  onSort,
}: LegBlockProps) {
  // All flights in a leg share the same departure date (query is
  // single-day), so surface it once in the header rather than repeating.
  const date = flights[0]?.departure.slice(0, 10);
  return (
    <Stack spacing={0.5}>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ letterSpacing: '0.14em' }}
      >
        {title} · {date} · {flights.length}
      </Typography>

      <FlightHeaderRow sort={sort} onSort={onSort} />

      <Stack spacing={0}>
        {flights.map((f) => (
          <FlightRow
            key={f.flight_instance_id}
            flight={f}
            passengers={passengers}
          />
        ))}
      </Stack>
    </Stack>
  );
}
