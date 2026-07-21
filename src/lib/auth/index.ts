import NextAuth from 'next-auth';
import { authConfig } from './config';

// Single NextAuth() invocation for the whole app. All server-side auth
// operations (getting the session, signing in / out from server actions, the
// route handler) come from these four exports.
//
//   handlers  → mounted at /api/auth/[...nextauth]/route.ts
//   auth      → server-side session read (wrapped by src/lib/auth/session.ts)
//   signIn    → server-side sign-in (rarely used directly; UI uses client hooks)
//   signOut   → server-side sign-out (form-action target for the sign-out UI)
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
