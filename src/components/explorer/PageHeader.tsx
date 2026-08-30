import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

// Section header used at the top of every Explorer page: page title (h1,
// styled as h4) with a one- or two-line description underneath in muted
// body text. Peer of PanelHeader — page-level, not panel-level.
//
// `description` is ReactNode (not string) so callers can inline links,
// <code> spans, or emphasis without threading extra props through here.

export type PageHeaderProps = {
  title: string;
  description: ReactNode;
};

export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <Box>
      <Typography variant="h4" component="h1" gutterBottom>
        {title}
      </Typography>
      <Typography variant="body1" color="text.secondary">
        {description}
      </Typography>
    </Box>
  );
}
