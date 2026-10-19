import { beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

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
