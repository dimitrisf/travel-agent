'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';

// Persistent left rail on all /explorer pages. usePathname() drives the
// active-route highlight. Entries hardcoded — five stable items, no need
// for dynamic discovery.

type RailEntry = { label: string; href: string };

const ENTRIES: RailEntry[] = [
  { label: 'Weather', href: '/explorer/weather' },
  { label: 'Flights', href: '/explorer/flights' },
  { label: 'Hotels', href: '/explorer/hotels' },
  { label: 'Booking', href: '/explorer/booking' },
];

export function ExplorerRail() {
  const pathname = usePathname();

  return (
    <Box
      component="nav"
      aria-label="Explorer endpoints"
      sx={{
        width: 200,
        flexShrink: 0,
        borderRight: 1,
        borderColor: 'divider',
        py: 2,
      }}
    >
      <Typography
        variant="overline"
        sx={{ px: 2, color: 'text.secondary', letterSpacing: '0.14em' }}
      >
        Endpoints
      </Typography>
      <List sx={{ pt: 1 }}>
        {ENTRIES.map((e) => {
          const active = pathname === e.href;
          return (
            <ListItemButton
              key={e.href}
              component={Link}
              href={e.href}
              selected={active}
              sx={{ py: 0.75 }}
            >
              <ListItemText
                primary={e.label}
                slotProps={{
                  primary: {
                    variant: 'body2',
                    fontWeight: active ? 600 : 400,
                  },
                }}
              />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}
