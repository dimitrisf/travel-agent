import { styled } from '@pigment-css/react';

// Small header block used at the top of every Explorer form panel:
// title (h2, visually h6-scale) with the endpoint's method+path
// underneath in a mono font.
//
// Zero-runtime via Pigment CSS so this ships as a pure server component
// with no client boundary. Colors reference MUI theme CSS variables
// emitted by the root layout's ThemeProvider.

const Root = styled('div')({});

const Title = styled('h2')({
  fontSize: '1.25rem',
  fontWeight: 500,
  lineHeight: 1.6,
  letterSpacing: '0.0075em',
  margin: 0,
  color: 'var(--mui-palette-text-primary)',
});

const Endpoint = styled('span')({
  display: 'block',
  fontFamily: 'monospace',
  fontSize: '0.75rem',
  fontWeight: 400,
  lineHeight: 1.66,
  letterSpacing: '0.03333em',
  color: 'var(--mui-palette-text-secondary)',
});

export type PanelHeaderProps = {
  title: string;
  endpoint: string;
};

export function PanelHeader({ title, endpoint }: PanelHeaderProps) {
  return (
    <Root>
      <Title>{title}</Title>
      <Endpoint>{endpoint}</Endpoint>
    </Root>
  );
}
