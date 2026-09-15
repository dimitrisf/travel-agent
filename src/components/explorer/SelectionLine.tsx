import type { ReactNode } from 'react';
import { styled } from '@pigment-css/react';
import { formatEUR } from '@/utils/format';

// A single line inside the SelectionBar: icon + labelled description
// on the left, price on the right. Extracted so the three items
// (outbound / inbound / hotel) share one layout — otherwise the
// caller had to hand-roll the same Stack + Typography combo three
// times, and adding the per-item price would have widened all three
// call sites.
//
// Zero-runtime via Pigment CSS: this file has no hooks, handlers, or
// context, so it drops `'use client'` and its styles compile to plain
// CSS at build time — no MUI Emotion runtime for the row layout. Its
// parent (SelectionBar) is still `'use client'`, so this component
// still renders inside the client subtree; the win is bundle size,
// not a true SSR unlock. See FOOTNOTE at the bottom for the full
// migration analysis.

// Reproduces <Stack direction="row" spacing={1} alignItems="center">
// — flex row with 8px gap, vertically centered items.
const Row = styled('div')({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: '8px',
});

// Reproduces <Typography variant="body2"> plus the SelectionLine-
// specific sx (fontWeight: 600, flex: 1, minWidth: 0, wordBreak:
// 'break-word'). Font metrics come from MUI's body2 variant:
// 0.875rem font-size, 1.43 line-height, 0.01071em letter-spacing —
// matched exactly so the rendered result is pixel-identical. Renders
// as <p> (matching Typography's default component for body2).
const LabelText = styled('p')({
  fontSize: '0.875rem',
  fontWeight: 600,
  lineHeight: 1.43,
  letterSpacing: '0.01071em',
  margin: 0,
  flex: 1,
  minWidth: 0,
  wordBreak: 'break-word',
  color: 'var(--mui-palette-text-primary)',
});

// Reproduces <Typography variant="caption" color="text.secondary">
// plus the SelectionLine-specific sx (fontVariantNumeric:
// 'tabular-nums', flexShrink: 0). Font metrics from MUI's caption
// variant: 0.75rem, 1.66 line-height, 0.03333em letter-spacing.
// Renders as <span> (matching Typography's default component for
// caption, which is inline).
const PriceText = styled('span')({
  fontSize: '0.75rem',
  fontWeight: 400,
  lineHeight: 1.66,
  letterSpacing: '0.03333em',
  color: 'var(--mui-palette-text-secondary)',
  fontVariantNumeric: 'tabular-nums',
  flexShrink: 0,
});

export type SelectionLineProps = {
  icon: ReactNode;
  labelPrefix: string;
  label: string;
  priceEUR: number;
};

export function SelectionLine({
  icon,
  labelPrefix,
  label,
  priceEUR,
}: SelectionLineProps) {
  return (
    <Row>
      {icon}
      <LabelText>
        <span aria-label={labelPrefix}>{labelPrefix}: </span>
        {label}
      </LabelText>
      <PriceText>{formatEUR(priceEUR)}</PriceText>
    </Row>
  );
}

// ============================================================
// FOOTNOTE — Why this was migrated to Pigment
// ============================================================
//
// Preserved analysis on the trade-off. Referenced from the top
// comment; this is why the file drops `'use client'` and uses
// Pigment `styled` primitives instead of MUI Stack + Typography.
//
// Yes, and this one is an even easier win than HotelCard. Quick
// assessment:
//
// Structural check:
//   - No hooks, no state, no event handlers, no context.
//   - Only reads props and renders JSX — pure leaf.
//   - `icon` is a ReactNode passed down; whatever it is (MUI SVG
//     icons) is the parent's problem, not this component's.
//
// What needs replacing:
//   - `Stack direction="row" spacing={1} alignItems="center"` →
//     `styled('div')` with `display: flex; gap: 8px; align-items:
//     center`.
//   - Two `Typography` instances (variants `body2` and `caption`) →
//     `styled('p'|'span')` with body2's and caption's font metrics
//     baked in.
//
// Cost: ~20 lines of styled primitives, easier than HotelCardHeader
// (no Rating to reimplement). Value gained: same as HotelCard —
// smaller JS bundle for these styles (no Emotion runtime), faster
// paint.
//
// Boundary caveat (same as before): the parent SelectionBar is
// `'use client'` (uses useSelection context + clearAll onClick), so
// SelectionLine still renders in the client subtree regardless. The
// migration is a bundle-size win, not a "true SSR" unlock unless
// SelectionBar's parent also becomes server-first later.
