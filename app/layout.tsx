import type { Metadata } from 'next';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import CssBaseline from '@mui/material/CssBaseline';
import { AppThemeProvider } from '@/components/AppThemeProvider';
import { SettingsProvider } from '@/context/SettingsContext';
import { AuthProvider } from './providers';
import { Header } from '@/components/Header';

export const metadata: Metadata = {
  title: 'Travel Assistant',
  description: 'Chat with a travel-planning agent backed by OpenAI + MCP.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <SettingsProvider>
            <AppThemeProvider>
              <CssBaseline />
              <AuthProvider>
                <Header />
                {children}
              </AuthProvider>
            </AppThemeProvider>
          </SettingsProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
