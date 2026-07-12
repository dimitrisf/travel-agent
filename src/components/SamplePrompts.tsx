'use client';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { SAMPLE_PROMPTS } from '@/config/samplePrompts';

// Rendered when the chat is empty. Shows the seeded prompts from
// samplePrompts.ts as clickable chips; picking one dispatches it via
// onSelect. disabled greys everything out while a turn is in flight.
export function SamplePrompts({
  onSelect,
  disabled,
}: {
  onSelect: (prompt: string) => void;
  disabled: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, py: 2 }}>
      <Typography color="text.secondary" gutterBottom>
        Try one of these:
      </Typography>
      {SAMPLE_PROMPTS.map((p) => (
        <Chip
          key={p}
          label={p}
          onClick={() => onSelect(p)}
          clickable
          disabled={disabled}
          sx={{
            height: 'auto',
            py: 1,
            '& .MuiChip-label': { whiteSpace: 'normal' },
          }}
        />
      ))}
    </Box>
  );
}
