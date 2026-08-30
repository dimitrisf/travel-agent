import Box from '@mui/material/Box';
import { SortableHeader } from './SortableHeader';
import { FLIGHT_ROW_GRID, type SortSpec } from '@/lib/explorer/flights/sort';

// The clickable column-header strip above a leg's flight rows. Airline
// and route columns are unsortable (empty <Box /> slots) so the grid
// stays aligned with FlightRow.

export type FlightHeaderRowProps = {
  sort: SortSpec;
  onSort: (sort: SortSpec) => void;
};

export function FlightHeaderRow({ sort, onSort }: FlightHeaderRowProps) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: FLIGHT_ROW_GRID,
        gap: 2,
        alignItems: 'center',
        py: 0.5,
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Box />
      <SortableHeader
        label="Departure"
        mode="departure"
        sort={sort}
        onSort={onSort}
      />
      <SortableHeader
        label="Duration"
        mode="duration"
        sort={sort}
        onSort={onSort}
      />
      <Box />
      <SortableHeader
        label="Total"
        mode="price"
        sort={sort}
        onSort={onSort}
        align="right"
      />
    </Box>
  );
}
