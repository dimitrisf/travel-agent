import { redirect } from 'next/navigation';
import { auth } from './index';

// Domain type — NOT NextAuth's Session shape. Everywhere else in the app
// consumes this. When we swap auth libraries later (better-auth?), the shape
// stays the same and only this file's implementation changes.
export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
};

// Server-side session read. Returns null if not signed in. Safe to call from
// any server component, route handler, or server action. One DB round-trip
// per call (database session strategy) — cache within a request if needed.
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  if (!session?.user?.email) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
  };
}

// Signed-in-required variant. Redirects to /signin (the NextAuth default
// sign-in page for now) if no session. Use in protected route handlers and
// server actions where the caller must have an authenticated identity.
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  // Redirect to the sign-in page if the user is not authenticated.
  // Note: This is a server-side redirect, not a client-side navigation.
  // That's the built-in NextAuth sign-in page, served automatically by the [...nextauth] catch-all route handler we already have — we don't create it explicitly. When someone hits /api/auth/signin, NextAuth's handlers.GET renders a very basic HTML page listing all configured providers (in our case, one "Google" button).
  // We can see it right now: navigate to http://localhost:3000/api/auth/signin. We'll get a plain page with a "Sign in with Google" button, no chrome. It's the same OAuth flow the Header's Sign-in button triggers — just a different entry point.
  // If we want a branded sign-in page later:
  // 1. Add to authConfig:
  //    pages: { signIn: '/signin' }
  // 2. Then create app/signin/page.tsx — a proper MUI-styled page with our logo, marketing copy, whatever. The requireUser() redirect will point there instead of the default. Not needed for Phase 1, but on the roadmap if we want the app to look polished.
  if (!user) redirect('/api/auth/signin');
  return user;
}
