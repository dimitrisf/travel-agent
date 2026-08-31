'use client';

import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import { CitySelect } from '@/components/explorer/widgets/CitySelect';
import { PanelHeader } from '@/components/explorer/PanelHeader';
import { ResponsePanel } from '@/components/explorer/ResponsePanel';
import { SubmitBar } from '@/components/explorer/SubmitBar';
import { CurrentWeatherResults } from './CurrentWeatherResults';
import { explorerFetch } from '@/lib/explorer/explorerFetch';
import { notLoading, type ResponseState } from '@/lib/explorer/explorerTypes';
import { usePersistedState } from '@/lib/explorer/usePersistedState';
import type { CurrentWeatherResult } from '@/types/weather';

// Self-contained panel for /api/weather/current. Owns its own city input
// and response state; persists both via sessionStorage so the panel
// survives Explorer↔Assistant navigation.

export function CurrentWeatherPanel() {
  const [city, setCity] = usePersistedState(
    'explorer:weather:current:city',
    'Athens',
  );
  const [state, setState] = usePersistedState<
    ResponseState<CurrentWeatherResult>
  >('explorer:weather:current:state', { kind: 'idle' }, notLoading);

  const path = `/api/weather/current?city=${encodeURIComponent(city)}`;

  async function submit() {
    setState({ kind: 'loading' });
    const next = await explorerFetch<CurrentWeatherResult>({
      method: 'GET',
      path,
    });
    setState(next);
  }

  return (
    <Paper variant="outlined" sx={{ p: 3 }}>
      <PanelHeader title="Current weather" endpoint="GET /api/weather/current" />
      <Stack spacing={2} sx={{ mt: 2 }}>
        <CitySelect value={city} onChange={setCity} width={160} />
      </Stack>
      <SubmitBar
        submitLabel="Fetch current"
        onSubmit={submit}
        submitting={state.kind === 'loading'}
        curl={{ method: 'GET', path }}
      />
      <ResponsePanel
        state={state}
        renderPretty={(data) => <CurrentWeatherResults data={data} />}
      />
    </Paper>
  );
}
