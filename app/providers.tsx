'use client';

import CssBaseline from '@mui/material/CssBaseline';
import { SessionProvider } from 'next-auth/react';
import { ShareProvider } from '@/context/ShareContext';
import { SettingsProvider } from '@/context/SettingsContext';
import { AppThemeProvider } from '@/components/AppThemeProvider';

// Client-only wrappers for cross-cutting React contexts. Nested so all
// consumers can rely on every provider being present regardless of
// where they mount. The layout is a server component so this file
// exists purely to carry the 'use client' boundary.
//
//   SessionProvider  — NextAuth's session context; powers useCurrentUser
//   SettingsProvider — user preferences (localStorage + server-side);
//                      calls useSession internally, so it MUST be
//                      inside SessionProvider
//   AppThemeProvider — MUI ThemeProvider wrapping; reads themeMode from
//                      SettingsContext so it comes next
//   CssBaseline      — MUI's style reset; depends on the theme, so it
//                      sits inside AppThemeProvider
//   ShareProvider    — Share-state store for the Header's Share button
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {/* SettingsProvider now calls useCurrentUser() which uses NextAuth's useSession. So SessionProvider must wrap SettingsProvider. */}
      <SettingsProvider>
        <AppThemeProvider>
          <CssBaseline />
          <ShareProvider>{children}</ShareProvider>
        </AppThemeProvider>
      </SettingsProvider>
    </SessionProvider>
  );
}
