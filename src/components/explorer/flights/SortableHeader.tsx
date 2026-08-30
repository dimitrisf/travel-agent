'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import {
  toggleSort,
  type SortMode,
  type SortSpec,
} from '@/lib/explorer/flights/sort';

// Clickable column header for the flight results table. Renders the
// column label and, when this column is the active sort, an ↑/↓ arrow
// showing direction. Click and Enter/Space cycle direction via toggleSort.

export type SortableHeaderProps = {
  label: string;
  mode: SortMode;
  sort: SortSpec;
  onSort: (sort: SortSpec) => void;
  align?: 'left' | 'right';
};

export function SortableHeader({
  label,
  mode,
  sort,
  onSort,
  align = 'left',
}: SortableHeaderProps) {
  const active = sort.mode === mode;

  const handle = () => onSort(toggleSort(sort, mode));

  return (
    <Box
      onClick={handle}
      role="button"
      tabIndex={0}
      aria-label={`Sort by ${label}${active ? ` (${sort.direction})` : ''}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handle();
        }
      }}
      sx={{
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 0.25,
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        userSelect: 'none',
        color: active ? 'primary.main' : 'text.secondary',
        '&:hover': { color: 'primary.main' },
      }}
    >
      <Typography
        variant="caption"
        component="span"
        sx={{ fontWeight: active ? 600 : 500, letterSpacing: '0.06em' }}
      >
        {label}
      </Typography>
      {active &&
        (sort.direction === 'asc' ? (
          <ArrowUpwardIcon sx={{ fontSize: 14 }} />
        ) : (
          <ArrowDownwardIcon sx={{ fontSize: 14 }} />
        ))}
    </Box>
  );
}
