import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { LegBlock } from './LegBlock';
import { compareFlights, type SortSpec } from '@/lib/explorer/flights/sort';
import type { CabinClass } from '@/lib/pricing';
import type { SearchFlightsResult } from '@/lib/services/FlightService';

// Pretty view for a SearchFlightsResult. Renders outbound and return
// legs as independently-sortable blocks. Sort state is owned by the
// parent page (persisted via usePersistedState); this component just
// applies the comparator and forwards toggles.

export type FlightResultsProps = {
  data: SearchFlightsResult;
  passengers: number;
  cabinClass: CabinClass;
  outboundSort: SortSpec;
  inboundSort: SortSpec;
  onOutboundSort: (sort: SortSpec) => void;
  onInboundSort: (sort: SortSpec) => void;
};

export function FlightResults({
  data,
  passengers,
  cabinClass,
  outboundSort,
  inboundSort,
  onOutboundSort,
  onInboundSort,
}: FlightResultsProps) {
  const nothingFound = data.outbound.length === 0 && data.inbound.length === 0;
  const outbound = [...data.outbound].sort((a, b) =>
    compareFlights(outboundSort, a, b),
  );
  const inbound = [...data.inbound].sort((a, b) =>
    compareFlights(inboundSort, a, b),
  );

  return (
    <Stack spacing={2}>
      {nothingFound && (
        <Typography variant="body2" color="text.secondary">
          No flights match those filters.
        </Typography>
      )}
      {outbound.length > 0 && (
        <LegBlock
          title="Outbound"
          flights={outbound}
          passengers={passengers}
          cabinClass={cabinClass}
          sort={outboundSort}
          onSort={onOutboundSort}
        />
      )}
      {inbound.length > 0 && (
        <LegBlock
          title="Return"
          flights={inbound}
          passengers={passengers}
          cabinClass={cabinClass}
          sort={inboundSort}
          onSort={onInboundSort}
        />
      )}
    </Stack>
  );
}
