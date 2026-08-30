'use client';

import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import { FlightResults } from '@/components/explorer/flights/FlightResults';
import { FlightSearchForm } from '@/components/explorer/flights/FlightSearchForm';
import { PageHeader } from '@/components/explorer/PageHeader';
import { PanelHeader } from '@/components/explorer/PanelHeader';
import { ResponsePanel } from '@/components/explorer/ResponsePanel';
import { explorerFetch } from '@/lib/explorer/explorerFetch';
import { DEFAULT_SORT, type SortSpec } from '@/lib/explorer/flights/sort';
import { notLoading, type ResponseState } from '@/lib/explorer/explorerTypes';
import { usePersistedState } from '@/lib/explorer/usePersistedState';
import type { SearchFlightsResult } from '@/lib/services/FlightService';

export default function FlightsExplorerPage() {
  const [state, setState] = usePersistedState<
    ResponseState<SearchFlightsResult>
  >('explorer:flights:state', { kind: 'idle' }, notLoading);

  const [outboundSort, setOutboundSort] = usePersistedState<SortSpec>(
    'explorer:flights:outboundSort',
    DEFAULT_SORT,
  );

  const [inboundSort, setInboundSort] = usePersistedState<SortSpec>(
    'explorer:flights:inboundSort',
    DEFAULT_SORT,
  );

  // Passenger count from the LAST submitted search — sticky so per-leg
  // totals reflect the search that actually ran, not whatever the pax
  // steppers happen to show now. Persisted alongside the response.
  const [passengers, setPassengers] = usePersistedState(
    'explorer:flights:lastPassengers',
    1,
  );

  async function search({
    path,
    passengers: pax,
  }: {
    path: string;
    passengers: number;
  }) {
    setPassengers(pax);
    setState({ kind: 'loading' });
    const next = await explorerFetch<SearchFlightsResult>({
      method: 'GET',
      path,
    });
    setState(next);
  }

  return (
    <Stack spacing={4}>
      <PageHeader
        title="Flights"
        description="Search endpoint backing the search_flights tool. Seeded routes: five demo cities (ATH, BER, LHR, HND, JFK), 14-day rolling window of flight instances."
      />

      <Paper variant="outlined" sx={{ p: 3 }}>
        <PanelHeader title="Search flights" endpoint="GET /api/flights" />

        <FlightSearchForm
          submitting={state.kind === 'loading'}
          onSearch={search}
        />

        <ResponsePanel
          state={state}
          renderPretty={(data) => (
            <FlightResults
              data={data}
              passengers={passengers}
              outboundSort={outboundSort}
              inboundSort={inboundSort}
              onOutboundSort={setOutboundSort}
              onInboundSort={setInboundSort}
            />
          )}
        />
      </Paper>
    </Stack>
  );
}
