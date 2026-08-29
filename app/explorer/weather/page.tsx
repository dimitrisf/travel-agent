'use client';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { CitySelect } from '@/components/explorer/widgets/CitySelect';
import { ResponsePanel } from '@/components/explorer/ResponsePanel';
import { SubmitBar } from '@/components/explorer/SubmitBar';
import { explorerFetch } from '@/lib/explorer/explorerFetch';
import type { ResponseState } from '@/lib/explorer/explorerTypes';
import { usePersistedState } from '@/lib/explorer/usePersistedState';
import type { CurrentWeatherResult, ForecastResult } from '@/types/weather';

// Panel state survives Explorer↔Assistant navigation via sessionStorage so
// the user can flip back and forth to compare against the agent without
// losing the query they were on. Loading states are filtered out so a
// mid-flight navigation doesn't restore into a stuck spinner.
const notLoading = <T,>(s: ResponseState<T>) => s.kind !== 'loading';

export default function WeatherExplorerPage() {
  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h4" component="h1" gutterBottom>
          Weather
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Two GET endpoints backing the get_weather and get_forecast tools. Type
          any city to test the CITY_NOT_FOUND error path.
        </Typography>
      </Box>
      <CurrentWeatherPanel />
      <ForecastPanel />
    </Stack>
  );
}

function CurrentWeatherPanel() {
  const [city, setCity] = usePersistedState(
    'explorer:weather:current:city',
    'Athens',
  );

  // state is persisted so the user can flip to the agent and back without
  // losing the last response. Filter out loading so a mid-flight navigation
  // doesn't restore into a stuck spinner.
  // example value of state:
  // { kind: 'idle' } | { kind: 'loading' } | { kind: 'success', data: CurrentWeatherResult } | { kind: 'error', error: string }
  const [state, setState] = usePersistedState<
    ResponseState<CurrentWeatherResult>
  >(
    'explorer:weather:current:state',
    // initial state is idle
    { kind: 'idle' },
    // filter out loading states so a mid-flight navigation doesn't restore
    // into a stuck spinner.
    notLoading,
  );

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
      <PanelHeader
        title="Current weather"
        endpoint="GET /api/weather/current"
      />
      <Stack spacing={2} sx={{ mt: 2 }}>
        <CitySelect value={city} onChange={setCity} />
      </Stack>
      <SubmitBar
        submitLabel="Fetch current"
        onSubmit={submit}
        submitting={state.kind === 'loading'}
        curl={{ method: 'GET', path }}
      />
      <ResponsePanel
        state={state}
        renderPretty={(data) => (
          <Stack spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              {data.city}
            </Typography>
            <Typography variant="h4" component="div">
              {data.tempC}°C
            </Typography>
            <Typography variant="body2">{data.conditions}</Typography>
          </Stack>
        )}
      />
    </Paper>
  );
}

function ForecastPanel() {
  const [city, setCity] = usePersistedState(
    'explorer:weather:forecast:city',
    'Athens',
  );

  const [days, setDays] = usePersistedState(
    'explorer:weather:forecast:days',
    3,
  );

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
        renderPretty={(data) => <ForecastPretty data={data} />}
      />
    </Paper>
  );
}

function PanelHeader({ title, endpoint }: { title: string; endpoint: string }) {
  return (
    <Box>
      <Typography variant="h6" component="h2">
        {title}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        fontFamily="monospace"
      >
        {endpoint}
      </Typography>
    </Box>
  );
}

function ForecastPretty({ data }: { data: ForecastResult }) {
  const capped = data.providedDays < data.requestedDays;
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {data.city} · {data.providedDays} of {data.requestedDays} day
        {data.requestedDays === 1 ? '' : 's'}
        {capped ? ' (capped by provider)' : ''}
      </Typography>
      <Stack spacing={0.75}>
        {data.days.map((d) => (
          <Box
            key={d.date}
            sx={{
              display: 'grid',
              gridTemplateColumns: '110px 120px 1fr',
              gap: 2,
              alignItems: 'baseline',
            }}
          >
            <Typography variant="body2" fontFamily="monospace">
              {d.date}
            </Typography>
            <Typography
              variant="body2"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {d.tempCMin}° – {d.tempCMax}°C
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {d.conditions}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Stack>
  );
}
