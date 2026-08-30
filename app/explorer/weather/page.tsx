import Stack from '@mui/material/Stack';
import { PageHeader } from '@/components/explorer/PageHeader';
import { CurrentWeatherPanel } from '@/components/explorer/weather/CurrentWeatherPanel';
import { ForecastPanel } from '@/components/explorer/weather/ForecastPanel';

export default function WeatherExplorerPage() {
  return (
    <Stack spacing={4}>
      <PageHeader
        title="Weather"
        description="Two GET endpoints backing the get_weather and get_forecast tools. Type any city to test the CITY_NOT_FOUND error path."
      />
      <CurrentWeatherPanel />
      <ForecastPanel />
    </Stack>
  );
}
