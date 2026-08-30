'use client';

import FormControlLabel from '@mui/material/FormControlLabel';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';

// Optional price cap. Undefined value = filter is off (no max_price sent
// to the API). Toggling the switch on activates the slider at
// `defaultValue`; toggling off clears the value entirely so the caller
// can round-trip a "no cap" request.

export type PriceSliderProps = {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  label: string;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  disabled?: boolean;
};

export function PriceSlider({
  value,
  onChange,
  label,
  min = 0,
  max = 2000,
  step = 50,
  defaultValue = 500,
  disabled,
}: PriceSliderProps) {
  const enabled = value !== undefined;

  return (
    <Stack spacing={0.5} sx={{ minWidth: 260, maxWidth: 400 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={enabled}
              disabled={disabled}
              onChange={(e) =>
                onChange(e.target.checked ? defaultValue : undefined)
              }
            />
          }
          label={
            <Typography variant="caption">
              {enabled ? `€${value}` : 'no cap'}
            </Typography>
          }
          labelPlacement="start"
          sx={{ ml: 0, mr: 0 }}
        />
      </Stack>
      <Slider
        value={value ?? defaultValue}
        onChange={(_, next) =>
          onChange(
            // Ensure the next value is a number, even if the slider returns an array.
            typeof next === 'number' ? next : next[0],
          )
        }
        min={min}
        max={max}
        step={step}
        disabled={disabled || !enabled}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => `€${v}`}
        size="small"
      />
    </Stack>
  );
}
