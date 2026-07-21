'use client';

import { SessionProvider } from 'next-auth/react';

// Client-only wrapper for NextAuth's React context. Required for
// `useSession` (and therefore `useCurrentUser`) to work in client
// components. The layout is a server component so this has to be its own
// 'use client' boundary.
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
