'use client';

import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import { CITY_NAMES } from '@/lib/cities';

// Autocomplete over the demo library's cities (single source of truth in
// src/lib/cities.ts). Free-type allowed so the caller can trigger
// CITY_NOT_FOUND against an unknown name on purpose.

export type CitySelectProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
  // Per-call-site fixed width. Uses `width` (not maxWidth) because the
  // field's natural width is narrower than most call sites want — a
  // ceiling wouldn't do anything, but a fixed width forces the target.
  width?: number;
};

export function CitySelect({
  value,
  onChange,
  label = 'City',
  disabled,
  width = 320,
}: CitySelectProps) {
  return (
    <Autocomplete
      freeSolo
      options={CITY_NAMES.slice()}
      inputValue={value}
      onInputChange={(_, next) => onChange(next)}
      disabled={disabled}
      size="small"
      sx={{ width }}
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  );
}
