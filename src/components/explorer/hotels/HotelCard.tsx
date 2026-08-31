import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Rating from '@mui/material/Rating';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { HotelResult } from '@/lib/services/HotelService';

// One hotel result: name + stars + rating on the top row, address and
// room type below, amenities as chips, cancellation policy inline, and
// total + per-night price aligned to the right.

export type HotelCardProps = {
  hotel: HotelResult;
};

export function HotelCard({ hotel }: HotelCardProps) {
  const symbol = hotel.currency === 'EUR' ? '€' : `${hotel.currency} `;
  return (
    <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.100' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        alignItems={{ sm: 'flex-start' }}
        justifyContent="space-between"
      >
        <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
              {hotel.hotel}
            </Typography>
            <Rating value={hotel.stars} readOnly size="small" />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {hotel.rating.toFixed(1)} / 10
            </Typography>
          </Stack>

          <Typography variant="body2" color="text.secondary">
            {hotel.address}
          </Typography>

          <Typography variant="body2">
            {hotel.room_type} · {hotel.city}
          </Typography>

          {hotel.amenities.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {hotel.amenities.map((a) => (
                <Chip
                  key={a}
                  label={a}
                  size="small"
                  variant="outlined"
                  sx={{ bgcolor: 'grey.50' }}
                />
              ))}
            </Box>
          )}

          <Typography
            variant="caption"
            color={hotel.free_cancellation ? 'success.main' : 'text.secondary'}
          >
            {hotel.cancellation_description}
          </Typography>
        </Stack>

        <Stack alignItems={{ xs: 'flex-start', sm: 'flex-end' }} spacing={0}>
          <Typography
            variant="h6"
            sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
          >
            {symbol}
            {hotel.total_price}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {symbol}
            {hotel.price_per_night}/night × {hotel.nights} night
            {hotel.nights === 1 ? '' : 's'}
          </Typography>
        </Stack>
      </Stack>
    </Paper>
  );
}
