import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { formatEUR } from '@/utils/format';

// Total block: label + amount grouped together, right-flush
// against the parent Stack's edge. alignSelf: flex-end
// shrinks the block to its content width so the short
// borderTop above renders as a "subtotal line" over just
// the Total text, not spanning the whole row. The amount
// ends up in the same column as the per-line prices
// (same parent, both right-flush); "Total" sits one
// 8px-gap left of the amount, approximately under the
// hotel dates column when it's present.

export function SelectionTotal({ total }: { total: number }) {
  return (
    <Stack
      direction="row"
      alignItems="baseline"
      spacing={1}
      sx={{
        alignSelf: 'flex-end',
        borderTop: 1,
        borderColor: 'divider',
        pt: 0.5,
      }}
    >
      <Typography variant="caption" color="text.secondary">
        Total
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {formatEUR(total)}
      </Typography>
    </Stack>
  );
}
