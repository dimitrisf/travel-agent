'use client';

import Rating from '@mui/material/Rating';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// Minimum-stars filter. Click a star to set the floor ("N+ stars"); click
// the same star again to clear (undefined = no filter, the value the API
// treats as "any stars").

export type StarsSelectProps = {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  label?: string;
  disabled?: boolean;
};

export function StarsSelect({
  value,
  onChange,
  label = 'Min stars',
  disabled,
}: StarsSelectProps) {
  return (
    <Stack spacing={0.5} sx={{ minWidth: 160 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Rating
          value={value ?? null}
          onChange={(_, next) => onChange(next ?? undefined)}
          disabled={disabled}
          size="small"
        />
        <Typography variant="caption" color="text.secondary">
          {value ? `${value}+` : 'any'}
        </Typography>
      </Stack>
    </Stack>
  );
}
