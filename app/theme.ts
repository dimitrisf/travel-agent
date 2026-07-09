'use client';

import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'light',
    primary: { main: '#2f5b8b' },
    secondary: { main: '#c96b2c' },
    background: { default: '#f6f6f5' },
  },
  typography: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  shape: { borderRadius: 10 },
});

export default theme;
