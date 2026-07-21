import type { DefaultSession } from 'next-auth';

// Module augmentation — adds `id` to `session.user` so the session callback
// in src/lib/auth/config.ts can assign it and `getCurrentUser` can read it.
// Without this, `session.user.id = user.id` is a TS error and downstream
// consumers see `session.user` as `{ name?, email?, image? }` only.
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
  }
}
