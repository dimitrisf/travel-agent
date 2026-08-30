import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { CurrentWeatherResult } from '@/types/weather';

// Pretty view for a CurrentWeatherResult: city (small), temperature
// (large), conditions (small). Mirrors the ForecastResults pattern —
// each weather panel's pretty rendering lives in its own file.

export type CurrentWeatherResultsProps = {
  data: CurrentWeatherResult;
};

export function CurrentWeatherResults({ data }: CurrentWeatherResultsProps) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2" color="text.secondary">
        {data.city}
      </Typography>
      <Typography variant="h4" component="div">
        {data.tempC}°C
      </Typography>
      <Typography variant="body2">{data.conditions}</Typography>
    </Stack>
  );
}
