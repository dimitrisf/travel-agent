import { styled } from '@pigment-css/react';
import { EndpointCard } from '@/components/explorer/EndpointCard';
import { PageHeader } from '@/components/explorer/PageHeader';

// Explorer index. Four cards, one per sub-route. Each card links to a
// form-based UI that hits the underlying REST endpoint directly, so a
// reader can compare raw tool output against what the agent claims.
// See docs/ Explorer Sketch for the design rationale.
//
// Rendered as a pure server component: layout wrappers are Pigment
// styled elements (zero-runtime CSS, no client boundary), and the
// cards themselves are Pigment styled anchors. No MUI on this page.

const Page = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
});

const CardGrid = styled('div')({
  display: 'grid',
  gap: '16px',
  gridTemplateColumns: '1fr',
  '@media (min-width: 600px)': {
    gridTemplateColumns: 'repeat(2, 1fr)',
  },
});

export default function ExplorerIndex() {
  return (
    <Page>
      <PageHeader
        title="Explorer"
        description="Form-based UI hitting each REST endpoint directly. Compare what the tools actually returned against what the agent claimed."
      />
      <CardGrid>
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
      </CardGrid>
    </Page>
  );
}
