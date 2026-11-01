import { beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// Default mock for the client-side auth helpers so any test that
// renders a component which transitively calls `useCurrentUser`
// (e.g., SettingsProvider now reads it to drive server-side pref
// sync) doesn't need to wrap in SessionProvider. Returns the signed-
// out shape by default. Tests that need a signed-in user can
// override with a per-file `vi.mock('@/lib/auth/client', ...)`.
vi.mock('@/lib/auth/client', () => ({
  useCurrentUser: () => null,
  signInWithGoogle: () => Promise.resolve(),
  signOutCurrent: () => Promise.resolve(),
}));

// Clear localStorage before every test so persistent writes (e.g.
// SettingsProvider's write-effect pushing the current state to
// localStorage after render) don't leak into subsequent test files.
// sessionStorage is deliberately NOT cleared here — most tests that
// use it already manage it explicitly in their own beforeEach, and
// changing that behavior could mask regressions in those tests.
beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    // jsdom unavailable (shouldn't happen with the configured env)
  }
});
