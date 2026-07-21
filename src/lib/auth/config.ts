import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { getSharedPrisma } from '@/lib';

// NextAuth v5 config. Google is the only provider for Phase 1.
//
// Session strategy: "database" — a Session row is written per active login
// and read on every request that calls auth(). Costs one DB round-trip per
// request; buys the ability to invalidate a session server-side (delete the
// row) and to see who's currently logged in. See the schema notes on the
// Session model.
//
// The Prisma adapter reuses the app's shared PrismaClient (getSharedPrisma)
// so the auth tables share the connection pool with the rest of the app.
export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(getSharedPrisma()),
  session: { strategy: 'database' },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  callbacks: {
    // With database sessions, `session` receives the raw DB session row +
    // the user record. Copy the user id onto session.user so `getCurrentUser`
    // can read it without a second DB lookup. Without this, session.user
    // has name/email/image but no id.
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
};
