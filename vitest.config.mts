import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vitest config. Two Stage-23 waves have landed on top of Phase 1's
// original pure-logic setup: services-layer tests (Phase 2) and the
// LLM-inventory work's source-class + repository integration tests.
// This third wave adds React component tests via
// @testing-library/react + jsdom, which is why the environment is
// now jsdom by default and .tsx test files are picked up.
//
// jsdom over node for everything: keeps the config trivial. The
// existing server-side pure-logic tests don't touch the DOM globals
// jsdom adds, so they behave identically. The tiny extra startup
// cost per test file is invisible at this scale.
//
// .mts extension: Vitest expects its config in ESM form. This
// project's package.json has no `"type": "module"` (it's a Next.js
// app), so a plain .ts config gets loaded as CJS and warns. The
// .mts extension forces ESM handling for this file only.
export default defineConfig({
  // @vitejs/plugin-react handles JSX in .tsx test files. Next.js's
  // tsconfig has `jsx: "preserve"` for the Next.js transform, which
  // Vitest doesn't understand — without this plugin, JSX in test
  // files fails to parse.
  plugins: [react()],
  test: {
    // Colocated *.test.ts and *.test.tsx files next to their source.
    include: ['src/**/*.test.{ts,tsx}'],
    // Phase 2b integration tests live under *.integration.test.ts and
    // opt into a real Postgres via vitest.integration.config.mts. Keep
    // them out of the fast/mocked default suite so `npm test` stays
    // Docker-free.
    exclude: [...configDefaults.exclude, '**/*.integration.test.ts'],
    environment: 'jsdom',
    // jest-dom matchers (toBeInTheDocument, toHaveAttribute, etc.).
    // Import lives in a setup file so it runs once per test file
    // rather than needing to be imported in every .tsx test.
    setupFiles: ['./vitest.setup.ts'],
    // globals: false — always import `describe`/`it`/`expect` from
    // 'vitest' explicitly. Keeps test files self-documenting and
    // TypeScript-clean without a types/vitest ambient shim.
    globals: false,
  },
  // Native tsconfig path resolution — reads `paths` from tsconfig.json
  // so imports like `@/lib/services/CodedServiceError` resolve in
  // tests the same way they do in the app.
  resolve: {
    tsconfigPaths: true,
  },
});
