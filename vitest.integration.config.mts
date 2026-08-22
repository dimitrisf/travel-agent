import { defineConfig } from 'vitest/config';

// Vitest config for Phase 2b integration tests. Runs *.integration.test.ts
// files against a real Postgres from docker-compose.yml. Kept separate
// from vitest.config.mts because:
//   - Integration tests need pool: 'forks' with singleFork: true so
//     parallel workers can't share a Prisma client or race each
//     other's TRUNCATE cycles on the shared test DB.
//   - node environment (not jsdom) — nothing here touches the DOM,
//     and jsdom's per-file startup cost adds up when tests are
//     already slower from the real-DB round-trips.
//   - Different include glob — integration files opt in by suffix
//     rather than being picked up by the default *.test.ts pattern.
//
// Run: `npm run test:integration` (assumes `db:test:up` + `db:test:migrate`
// have been done — see package.json for the sequenced script).
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    globals: false,
    pool: 'forks',
    // Vitest 4 flattened poolOptions.forks.singleFork into the top-level
    // fileParallelism flag — false means one test file at a time, which
    // is what we need so no two integration files race the shared test
    // DB between each other's TRUNCATE cycles.
    fileParallelism: false,
    // Real DB round-trips + Prisma engine startup on a cold worker
    // routinely eat 5-10s. 30s gives plenty of headroom without
    // masking genuinely stuck tests.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    tsconfigPaths: true,
  },
});
