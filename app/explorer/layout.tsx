import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import { ExplorerRail } from '@/components/explorer/ExplorerRail';
import { SelectionBar } from '@/components/explorer/SelectionBar';
import { SelectionProvider } from '@/context/SelectionContext';

// Nested layout for /explorer routes. Root layout already provides the
// global Header, ThemeProvider, and AuthProvider; this layout adds the
// persistent left rail alongside the main content area, plus the
// booking-selection provider that carries flight/hotel picks across
// pages (see SelectionContext). The SelectionBar sits at the top of
// main content and self-hides when the cart is empty.
export default function ExplorerLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <SelectionProvider>
      <Box sx={{ display: 'flex', minHeight: 'calc(100vh - 64px)' }}>
        <ExplorerRail />
        <Box component="main" sx={{ flex: 1, p: 3, maxWidth: 1000 }}>
          <Stack spacing={3}>
            <SelectionBar />
            {children}
          </Stack>
        </Box>
      </Box>
    </SelectionProvider>
  );
}
