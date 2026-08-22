import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@prisma/client';

// Load .env.test explicitly (override:true so a stray .env in the repo
// root can't leak the real dev DATABASE_URL into a test run). Runs at
// module-load time — every integration test file starts with an import
// from this module, so the URL is fixed before any Prisma client is
// instantiated.
loadDotenv({
  path: path.resolve(process.cwd(), '.env.test'),
  override: true,
});

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    'DATABASE_URL not set. Copy .env.test.example to .env.test and run `npm run db:test:up`.',
  );
}

// Safety fence — refuse to run against anything that doesn't look like
// a local test DB. Cheap defence against a rogue .env override or a
// misconfigured CI secret. Update the allowlist if you legitimately
// need a remote test DB (Neon test branch, etc.).
if (!/^postgresql:\/\/[^@]+@(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url)) {
  throw new Error(
    `Refusing to run integration tests against ${url.replace(/\/\/[^@]+@/, '//***@')}. ` +
      'Integration tests only run against a local Postgres (localhost / 127.0.0.1). ' +
      'See src/lib/testing/prismaTestClient.ts for the safety check.',
  );
}

// Fresh Prisma client per call — integration tests use one per suite
// and disconnect in afterAll. Not memoized because vitest's singleFork
// pool still spawns one worker per test file and each file wants a
// clean client (Prisma keeps its own connection pool per client and
// they leak between test files otherwise).
export function createTestPrisma(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url } },
  });
}

// Truncate every data-carrying table between tests to reset state
// without dropping the schema. TRUNCATE ... CASCADE handles FK order
// automatically; RESTART IDENTITY resets the autoincrement sequences
// so per-test row ids stay predictable.
//
// Table list is discovered at runtime from pg_catalog rather than
// hard-coded, so new Prisma models auto-include without touching this
// file. Excludes Prisma's own migrations bookkeeping so `db:test:migrate`
// output survives resets.
export async function resetDb(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_catalog.pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}
