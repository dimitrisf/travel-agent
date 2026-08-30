'use client';

import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { CitySelect } from '@/components/explorer/widgets/CitySelect';
import { PanelHeader } from '@/components/explorer/PanelHeader';
import { ResponsePanel } from '@/components/explorer/ResponsePanel';
import { SubmitBar } from '@/components/explorer/SubmitBar';
import { ForecastResults } from './ForecastResults';
import { explorerFetch } from '@/lib/explorer/explorerFetch';
import { notLoading, type ResponseState } from '@/lib/explorer/explorerTypes';
import { usePersistedState } from '@/lib/explorer/usePersistedState';
import type { ForecastResult } from '@/types/weather';

// Self-contained panel for /api/weather/forecast. Owns city + days
// inputs and response state; persists everything so navigation
// round-trips preserve the query.

export function ForecastPanel() {
  const [city, setCity] = usePersistedState(
    'explorer:weather:forecast:city',
    'Athens',
  );
  const [days, setDays] = usePersistedState('explorer:weather:forecast:days', 3);
  const [state, setState] = usePersistedState<ResponseState<ForecastResult>>(
    'explorer:weather:forecast:state',
    { kind: 'idle' },
    notLoading,
  );

  const path = `/api/weather/forecast?city=${encodeURIComponent(city)}&days=${days}`;

  async function submit() {
    setState({ kind: 'loading' });
    const next = await explorerFetch<ForecastResult>({
      method: 'GET',
      path,
    });
    setState(next);
  }

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <PanelHeader title="Forecast" endpoint="GET /api/weather/forecast" />
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ mt: 2 }}
        alignItems={{ sm: 'flex-start' }}
      >
        <CitySelect value={city} onChange={setCity} />
        <TextField
          label="Days"
          type="number"
          value={days}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!Number.isNaN(n)) setDays(n);
          }}
          size="small"
          inputProps={{ min: 1, max: 7 }}
          sx={{ maxWidth: 120 }}
          helperText="1–7"
        />
      </Stack>
      <SubmitBar
        submitLabel="Fetch forecast"
        onSubmit={submit}
        submitting={state.kind === 'loading'}
        curl={{ method: 'GET', path }}
      />
      <ResponsePanel
        state={state}
        renderPretty={(data) => <ForecastResults data={data} />}
      />
    </Paper>
  );
}
