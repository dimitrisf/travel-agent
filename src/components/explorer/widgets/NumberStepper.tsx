'use client';

import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';

// Integer input with -/+ buttons flanking a small readonly text display.
// Clamps to [min, max] on every change so callers never see an
// out-of-range value.

export type NumberStepperProps = {
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  disabled?: boolean;
};

export function NumberStepper({
  value,
  onChange,
  label,
  min = 0,
  max = 99,
  disabled,
}: NumberStepperProps) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));

  return (
    <Stack spacing={0.5} sx={{ minWidth: 120 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <IconButton
          size="small"
          onClick={() => onChange(clamp(value - 1))}
          disabled={disabled || value <= min}
          aria-label={`decrement ${label}`}
        >
          <RemoveIcon fontSize="small" />
        </IconButton>
        <TextField
          value={value}
          size="small"
          disabled={disabled}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            if (!Number.isNaN(n)) onChange(clamp(n));
          }}
          inputProps={{
            style: { textAlign: 'center', width: 40 },
            inputMode: 'numeric',
            'aria-label': label,
          }}
        />
        <IconButton
          size="small"
          onClick={() => onChange(clamp(value + 1))}
          disabled={disabled || value >= max}
          aria-label={`increment ${label}`}
        >
          <AddIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Stack>
  );
}
