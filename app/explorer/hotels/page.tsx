'use client';

import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import { HotelResults } from '@/components/explorer/hotels/HotelResults';
import { HotelSearchForm } from '@/components/explorer/hotels/HotelSearchForm';
import { PageHeader } from '@/components/explorer/PageHeader';
import { PanelHeader } from '@/components/explorer/PanelHeader';
import { ResponsePanel } from '@/components/explorer/ResponsePanel';
import { explorerFetch } from '@/lib/explorer/explorerFetch';
import { notLoading, type ResponseState } from '@/lib/explorer/explorerTypes';
import { usePersistedState } from '@/lib/explorer/usePersistedState';
import type { HotelResult } from '@/lib/services/HotelService';

export default function HotelsExplorerPage() {
  const [state, setState] = usePersistedState<ResponseState<HotelResult[]>>(
    'explorer:hotels:state',
    { kind: 'idle' },
    notLoading,
  );

  async function search({ path }: { path: string }) {
    setState({ kind: 'loading' });
    const next = await explorerFetch<HotelResult[]>({ method: 'GET', path });
    setState(next);
  }

  return (
    <Stack spacing={4}>
      <PageHeader
        title="Hotels"
        description="Search endpoint backing the search_hotels tool. Seeded hotels across the five demo cities, 21-day rolling availability window; prices scale on Fri/Sat."
      />

      <Paper variant="outlined" sx={{ p: 3 }}>
        <PanelHeader title="Search hotels" endpoint="GET /api/hotels" />

        <HotelSearchForm
          submitting={state.kind === 'loading'}
          onSearch={search}
        />

        <ResponsePanel
          state={state}
          renderPretty={(data) => <HotelResults data={data} />}
        />
      </Paper>
    </Stack>
  );
}
