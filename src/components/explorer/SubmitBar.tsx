'use client';

import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import { CurlButton, type CurlButtonProps } from './CurlButton';

// A row combining Submit + optional Reset + Copy-as-curl. Used at the
// bottom of every endpoint form so the shape stays consistent.

export type SubmitBarProps = {
  submitLabel: string;
  onSubmit: () => void;
  submitting?: boolean;
  onReset?: () => void;
  curl: CurlButtonProps;
};

export function SubmitBar({
  submitLabel,
  onSubmit,
  submitting,
  onReset,
  curl,
}: SubmitBarProps) {
  return (
    <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
      <Button variant="contained" onClick={onSubmit} disabled={submitting}>
        {submitLabel}
      </Button>
      {onReset && (
        <Button variant="text" onClick={onReset} disabled={submitting}>
          Reset
        </Button>
      )}
      <CurlButton {...curl} disabled={submitting} />
    </Stack>
  );
}
