import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { ForecastResult } from '@/types/weather';

// Pretty view for a ForecastResult: one row per day (date · min–max · conditions).
// Notes when providedDays < requestedDays (provider cap, e.g. OWM's 5-day cap).

export type ForecastResultsProps = {
  data: ForecastResult;
};

export function ForecastResults({ data }: ForecastResultsProps) {
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
