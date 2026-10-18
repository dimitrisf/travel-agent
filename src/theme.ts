'use client';

import { createTheme, type Theme } from '@mui/material/styles';
import type { ThemeMode } from '@/context/SettingsContext';

// Factory rather than a singleton: a settings-aware wrapper
// (AppThemeProvider) rebuilds the theme whenever the user flips the
// theme toggle, so palette.mode and mode-dependent values (background,
// surface tints) stay in sync.
export function createAppTheme(mode: ThemeMode): Theme {
  return createTheme({
    cssVariables: true,
    palette: {
      mode,
      primary: { main: '#2f5b8b' },
      secondary: { main: '#c96b2c' },
      background: {
        default: mode === 'light' ? '#f6f6f5' : '#121212',
      },
    },
    typography: {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    },
    shape: { borderRadius: 10 },
  });
}
