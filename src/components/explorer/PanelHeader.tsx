import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

// Small header block used at the top of every Explorer form panel:
// title (h2) with the endpoint's method+path underneath in a mono font.

export type PanelHeaderProps = {
  title: string;
  endpoint: string;
};

export function PanelHeader({ title, endpoint }: PanelHeaderProps) {
  return (
    <Box>
      <Typography variant="h6" component="h2">
        {title}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        fontFamily="monospace"
      >
        {endpoint}
      </Typography>
    </Box>
  );
}
