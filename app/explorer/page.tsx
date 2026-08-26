import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { EndpointCard } from '@/components/explorer/EndpointCard';

// Explorer index. Four cards, one per sub-route. Each card links to a
// form-based UI that hits the underlying REST endpoint directly, so a
// reader can compare raw tool output against what the agent claims.
// See docs/ Explorer Sketch for the design rationale.
export default function ExplorerIndex() {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box>
        <Typography variant="h4" component="h1" gutterBottom>
          Explorer
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Form-based UI hitting each REST endpoint directly. Compare what
          the tools actually returned against what the agent claimed.
        </Typography>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
          gap: 2,
        }}
      >
        <EndpointCard
          title="Weather"
          href="/explorer/weather"
          blurb="Current conditions and multi-day forecast for the five demo cities."
          sample="GET /api/weather/current?city=Berlin"
        />
        <EndpointCard
          title="Flights"
          href="/explorer/flights"
          blurb="Flight search with origin, destination, dates, cabin class, filters."
          sample="GET /api/flights?origin=ATH&destination=BER&departure_date=..."
        />
        <EndpointCard
          title="Hotels"
          href="/explorer/hotels"
          blurb="Hotel search with city, dates, guests, stars, amenities, price cap."
          sample="GET /api/hotels?city=Berlin&checkin=...&checkout=..."
        />
        <EndpointCard
          title="Booking"
          href="/explorer/booking"
          blurb="Propose a booking or load one by reference; operate via BookingCard."
          sample="POST /api/booking/propose · GET /api/booking/:id"
        />
      </Box>
    </Box>
  );
}
