import Link from 'next/link';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';

// Index-page card linking to a sub-route. Title + short blurb + mono sample
// query so the reader gets a preview of what the endpoint looks like.

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
    <Card variant="outlined" sx={{ height: '100%' }}>
      {/* Wrapped in CardActionArea so the whole card is clickable */}
      <CardActionArea component={Link} href={href} sx={{ height: '100%' }}>
        <CardContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}
        >
          <Typography variant="h6" component="h2">
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {blurb}
          </Typography>
          <Box
            component="pre"
            sx={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12,
              color: 'text.secondary',
              m: 0,
              mt: 0.5,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {sample}
          </Box>
          <Typography variant="caption" color="primary" sx={{ mt: 0.5 }}>
            Try it &rarr;
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
