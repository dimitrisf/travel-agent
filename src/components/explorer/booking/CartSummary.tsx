import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { Cart } from '@/types/booking';

// Compact review of what's about to be proposed. Uses the labels the
// row-click captured so the display is consistent with what the user
// saw in the search results, not what the form currently shows.
// Rendered by BookingPanel between the search flow and the propose
// call — every visible field comes from the cart snapshot, so this
// component stays purely presentational.

export function CartSummary({ cart }: { cart: Cart }) {
  const rows: Array<[string, string, number]> = [];

  if (cart.outboundFlight) {
    rows.push([
      'Outbound',
      cart.outboundFlight.label,
      cart.outboundFlight.totalEUR,
    ]);
  }

  if (cart.inboundFlight) {
    rows.push([
      'Return',
      cart.inboundFlight.label,
      cart.inboundFlight.totalEUR,
    ]);
  }

  if (cart.hotel) {
    rows.push(['Hotel', cart.hotel.label, cart.hotel.totalEUR]);
  }

  const total = rows.reduce((acc, [, , v]) => acc + v, 0);

  return (
    <Stack spacing={1}>
      {rows.map(([label, name, price]) => (
        <Stack
          key={label}
          direction="row"
          justifyContent="space-between"
          alignItems="baseline"
        >
          <Typography variant="body2">
            <strong>{label}:</strong> {name}
          </Typography>
          <Typography
            variant="body2"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
          >
            €{price}
          </Typography>
        </Stack>
      ))}
      <Stack
        direction="row"
        justifyContent="space-between"
        sx={{ borderTop: 1, borderColor: 'divider', pt: 1 }}
      >
        <Typography variant="subtitle2">Total</Typography>
        <Typography
          variant="subtitle2"
          sx={{ fontVariantNumeric: 'tabular-nums' }}
        >
          €{total}
        </Typography>
      </Stack>
    </Stack>
  );
}
