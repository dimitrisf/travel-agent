import { handlers } from '@/lib/auth';

// NextAuth v5 mounts BOTH GET and POST from `handlers`. Every auth flow
// (OAuth redirect, callback, sign-out POST, session lookup) hits this route.
export const { GET, POST } = handlers;
