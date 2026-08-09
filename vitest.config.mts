import { defineConfig } from 'vitest/config';

// Vitest config for Stage 23 Phase 1 (pure-logic unit tests). No
// setup files, no DOM environment — the tests currently target
// server-side pure logic (weather aggregation, retry helper, error
// taxonomy, cache helpers). When Phase 2 lands (repository tests
// with a real Prisma DB, or React component tests), we'll extend
// this config.
//
// .mts extension: Vitest expects its config in ESM form. This
// project's package.json has no `"type": "module"` (it's a Next.js
// app), so a plain .ts config gets loaded as CJS and warns. The
// .mts extension forces ESM handling for this file only.
export default defineConfig({
  test: {
    // Colocated *.test.ts files next to their source.
    include: ['src/**/*.test.ts'],
    // Node environment (server-side pure logic — no DOM).
    environment: 'node',
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
