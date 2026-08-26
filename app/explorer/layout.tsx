import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import { ExplorerRail } from '@/components/explorer/ExplorerRail';

// Nested layout for /explorer routes. Root layout already provides the
// global Header, ThemeProvider, and AuthProvider; this layout just adds
// the persistent left rail alongside the main content area.
export default function ExplorerLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', minHeight: 'calc(100vh - 64px)' }}>
      <ExplorerRail />
      <Box component="main" sx={{ flex: 1, p: 3, maxWidth: 1000 }}>
        {children}
      </Box>
    </Box>
  );
}
