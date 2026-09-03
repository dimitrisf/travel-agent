import type { ReactNode } from 'react';
import { styled } from '@pigment-css/react';

// Section header used at the top of every Explorer page: page title (h1,
// visually h4-scale) with a one- or two-line description underneath in
// muted body text. Peer of PanelHeader — page-level, not panel-level.
//
// `description` is ReactNode (not string) so callers can inline links,
// <code> spans, or emphasis without threading extra props through here.
//
// Zero-runtime via Pigment CSS so the whole component ships as a pure
// server component with no client boundary. Colors reference the MUI
// theme's CSS variables (emitted by the root layout's ThemeProvider)
// so the visual stays aligned with the rest of the app.

const Root = styled('div')({});

const Title = styled('h1')({
  fontSize: '2.125rem',
  fontWeight: 400,
  lineHeight: 1.235,
  letterSpacing: '0.00735em',
  margin: 0,
  marginBottom: '0.35em',
  color: 'var(--mui-palette-text-primary)',
});

const Description = styled('p')({
  fontSize: '1rem',
  fontWeight: 400,
  lineHeight: 1.5,
  letterSpacing: '0.00938em',
  margin: 0,
  color: 'var(--mui-palette-text-secondary)',
});

export type PageHeaderProps = {
  title: string;
  description: ReactNode;
};

export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <Root>
      <Title>{title}</Title>
      <Description>{description}</Description>
    </Root>
  );
}
