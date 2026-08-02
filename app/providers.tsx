'use client';

import { SessionProvider } from 'next-auth/react';
import { ShareProvider } from '@/lib/share/ShareContext';

// Client-only wrappers for cross-cutting React contexts. Nested so all
// consumers can rely on both being present regardless of where they
// mount. The layout is a server component so this file exists purely to
// carry the 'use client' boundary.
//
//   AuthProvider  — NextAuth's SessionProvider; powers useCurrentUser
//   ShareProvider — Phase 4 share-state store; powers the Header's
//                   Share button and the ShareModal
export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ShareProvider>{children}</ShareProvider>
    </SessionProvider>
  );
}
