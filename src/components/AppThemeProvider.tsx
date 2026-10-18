'use client';

import { useMemo, type ReactNode } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { useSettings } from '@/context/SettingsContext';
import { createAppTheme } from '@/theme';

// Client-side wrapper that rebuilds the MUI theme on each theme-mode
// change. Settings live in a client-only context (localStorage-backed),
// so this bridge pushes the dynamic mode into MUI's ThemeProvider —
// which app/layout.tsx would otherwise have to pin to a single mode
// at the server boundary.
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const { themeMode } = useSettings();
  const theme = useMemo(() => createAppTheme(themeMode), [themeMode]);
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
