'use client';

import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import { CITIES } from '@/lib/cities';

// Autocomplete over the demo library's airports (one per city in the
// CITIES SoT). Options display as "ATH — Athens" but the controlled
// value is the raw IATA code so callers can pass it straight to
// /api/flights. Free-type allowed so the caller can trigger
// AIRPORT_NOT_FOUND against an unknown IATA on purpose.

type AirportOption = {
  iata: string;
  city: string;
  label: string;
};

// Options for the Autocomplete component, derived from the CITIES SoT.
const OPTIONS: AirportOption[] = Object.entries(CITIES).map(
  ([city, { iata }]) => ({
    iata,
    city,
    label: `${iata} — ${city}`,
  }),
);

const IATA_TO_LABEL = new Map(OPTIONS.map((o) => [o.iata, o.label]));

export type AirportSelectProps = {
  value: string;
  onChange: (iata: string) => void;
  label?: string;
  disabled?: boolean;
  // Hide this IATA from the dropdown — used to prevent picking the same
  // airport for origin and destination. Free-typing still bypasses this,
  // so callers must also validate at submit time.
  excludeIata?: string;
};

export function AirportSelect({
  value,
  onChange,
  label = 'Airport',
  disabled,
  excludeIata,
}: AirportSelectProps) {
  // Determine the displayed input value based on the selected IATA code.
  // E.g., if value is "ATH", inputValue will be "ATH — Athens".
  const inputValue = IATA_TO_LABEL.get(value) ?? value;

  // options to display in the dropdown, potentially filtered to exclude the specified IATA code.
  // E.g., if excludeIata is "ATH", the option for "ATH — Athens" will be removed from the dropdown.
  const options = excludeIata
    ? OPTIONS.filter((o) => o.iata !== excludeIata)
    : OPTIONS;

  return (
    <Autocomplete
      freeSolo
      options={options}
      getOptionLabel={(o) => (typeof o === 'string' ? o : o.label)}
      inputValue={inputValue}
      // Handle changes to the input value, including free-typed values and selections from the dropdown.
      // next argument is the new input value, reason indicates why it changed.
      onInputChange={(_, next, reason) => {
        // Selection sets `next` to the option's label ("ATH — Athens").
        // Extract the IATA prefix so downstream still gets a clean code.
        // reason is set to 'input' for free-typed values and 'reset' for selections from the dropdown.
        if (reason === 'reset') {
          const match = OPTIONS.find((o) => o.label === next);
          onChange(match ? match.iata : next);
          return;
        }
        onChange(next.toUpperCase());
      }}
      isOptionEqualToValue={(o, v) =>
        typeof v === 'string' ? o.iata === v : o.iata === v.iata
      }
      disabled={disabled}
      size="small"
      sx={{ width: 200 }}
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  );
}
