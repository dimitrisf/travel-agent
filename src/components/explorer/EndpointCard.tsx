import Link from 'next/link';
import { styled } from '@pigment-css/react';

// Index-page card linking to a sub-route. Title + short blurb + mono sample
// query so the reader gets a preview of what the endpoint looks like.
//
// Zero-runtime via Pigment CSS: the entire card is a plain <a> from
// next/link with card styling applied directly, so no MUI runtime and
// no client boundary. The whole card is one accessible link (a single
// tab stop; screen readers announce it as one item), matching the
// previous CardActionArea + component={Link} behavior.
//
// Colors reference MUI's CSS variables emitted by the root layout's
// ThemeProvider so the visual stays aligned with the rest of the app.

const CardLink = styled(Link)({
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  height: '100%',
  padding: '16px',
  border: '1px solid var(--mui-palette-divider)',
  borderRadius: '10px',
  backgroundColor: 'var(--mui-palette-background-paper)',
  color: 'inherit',
  textDecoration: 'none',
  transition: 'background-color 120ms ease, border-color 120ms ease',
  '&:hover': {
    backgroundColor: 'var(--mui-palette-action-hover)',
  },
  '&:focus-visible': {
    outline: '2px solid var(--mui-palette-primary-main)',
    outlineOffset: '2px',
  },
});

const Title = styled('h2')({
  fontSize: '1.25rem',
  fontWeight: 500,
  lineHeight: 1.6,
  letterSpacing: '0.0075em',
  margin: 0,
  color: 'var(--mui-palette-text-primary)',
});

const Blurb = styled('p')({
  fontSize: '0.875rem',
  fontWeight: 400,
  lineHeight: 1.43,
  letterSpacing: '0.01071em',
  margin: 0,
  color: 'var(--mui-palette-text-secondary)',
});

const Sample = styled('pre')({
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '12px',
  color: 'var(--mui-palette-text-secondary)',
  margin: 0,
  marginTop: '4px',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
});

const TryIt = styled('span')({
  display: 'block',
  fontSize: '0.75rem',
  fontWeight: 400,
  lineHeight: 1.66,
  letterSpacing: '0.03333em',
  marginTop: '4px',
  color: 'var(--mui-palette-primary-main)',
});

export type EndpointCardProps = {
  title: string;
  href: string;
  blurb: string;
  sample: string;
};

export function EndpointCard({
  title,
  href,
  blurb,
  sample,
}: EndpointCardProps) {
  return (
    <CardLink href={href}>
      <Title>{title}</Title>
      <Blurb>{blurb}</Blurb>
      <Sample>{sample}</Sample>
      <TryIt>Try it &rarr;</TryIt>
    </CardLink>
  );
}
