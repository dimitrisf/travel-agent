import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';
import { ZodError } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { createTestPrisma, resetDb } from '@/lib/testing/prismaTestClient';
import { seedUser } from '@/lib/testing/seedFixtures';
import { SettingsService } from './SettingsService';
import { SettingsServiceError } from './SettingsServiceError';
import { SettingsRepository } from '../repositories/SettingsRepository';

// Integration coverage for the Settings persistence layer. Exercises
// SettingsService + SettingsRepository + Prisma against a real
// Postgres so the full chain — Zod validation → repo → User.dateFormat
// / User.themeMode columns — is proved end-to-end.
//
// Why integration rather than the mocked SettingsService.test.ts:
// the mocked suite stubs the repo, so it never actually proves that
//   - the schema's unknown-field strip reaches the DB (an accidental
//     passthrough would silently write to arbitrary User columns);
//   - null writes land as SQL NULL (not an empty string or '"null"');
//   - Prisma's P2025 "record not found" error gets wrapped as a
//     SettingsServiceError the route handler can translate to 500.
// Same slot the BookingService integration tests occupy for the
// transactional write path — see BookingService.integration.test.ts
// for the broader "Phase 2b" rationale.
//
// There's no API-route test here; the route handler at
// app/api/settings/route.ts is thin auth + delegation wiring (same
// shape as app/api/bookings/route.ts, also untested at that level)
// so the service-level coverage is where the behaviour actually lives.
//
// --------------------------------------------------------------------
// Test outline — 12 tests across the full chain
// --------------------------------------------------------------------
//
// getForUser (3):
//   - returns { dateFormat: null, themeMode: null } for a user with
//     no prefs saved — proves "user exists but empty row" is
//     distinguishable from "user missing".
//   - returns null for a missing user — the branch the route handler
//     coerces into a response shape.
//   - round-trips values written by updateForUser.
//
// updateForUser (9):
//   - persists dateFormat-only; themeMode stays SQL NULL
//     (verified via a raw Prisma read-back).
//   - persists themeMode-only; dateFormat stays SQL NULL.
//   - writes both fields in one call — the localStorage → server
//     promotion-flow path on first sign-in.
//   - a second update doesn't disturb the other field (partial-update
//     invariant: a regression to full-row writes would clobber the
//     untouched preference every time).
//   - null writes clear a previously-set preference back to SQL NULL.
//   - unknown-field strip reaches Prisma — a PATCH piggybacking
//     `email: 'attacker@...'` and `isAdmin: true` writes dateFormat
//     only; email stays as seeded.
//   - invalid dateFormat value is rejected with ZodError before any
//     DB write; row stays untouched.
//   - empty PATCH is rejected with ZodError.
//   - Prisma's P2025 (record not found) is wrapped as
//     SettingsServiceError so apiErrorResponse can serialize it to
//     a stable 500 shape instead of leaking the Prisma error.
//
// What this suite covers that the mocked SettingsService.test.ts
// cannot:
//   1. The Zod unknown-field strip actually prevents writes to real
//      User columns (not just that the mock wasn't called with them).
//   2. JS null becomes SQL NULL (not an empty string, '"null"', or
//      the schema default).
//   3. Prisma's P2025 propagates through the service's try/catch and
//      gets wrapped — a bare Prisma error would leak the query shape
//      to the client.

describe('SettingsService (integration)', () => {
  let prisma: PrismaClient;
  let service: SettingsService;

  beforeAll(() => {
    prisma = createTestPrisma();
    service = new SettingsService({
      repo: new SettingsRepository({ prisma }),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  describe('getForUser', () => {
    it('returns a null-valued row for a user who has no prefs saved yet', async () => {
      // seedUser creates a plain User row — both dateFormat and
      // themeMode are nullable with no default, so the baseline row
      // has them both NULL. The read-back shape must preserve that
      // distinction so the client can tell "not set" from "set to a
      // specific value".
      const alice = await seedUser(prisma, { id: 'alice' });

      const settings = await service.getForUser(alice.id);

      expect(settings).toEqual({ dateFormat: null, themeMode: null });
    });

    it("returns null when the user doesn't exist (service stays unopinionated)", async () => {
      // The route handler owns the 401 vs "signed-in with empty row"
      // decision; the service just surfaces the row-or-nothing state
      // from Prisma.
      const settings = await service.getForUser('ghost');
      expect(settings).toBeNull();
    });

    it('round-trips values written by updateForUser', async () => {
      const alice = await seedUser(prisma, { id: 'alice' });
      await service.updateForUser(alice.id, {
        dateFormat: 'us',
        themeMode: 'dark',
      });

      const settings = await service.getForUser(alice.id);
      expect(settings).toEqual({ dateFormat: 'us', themeMode: 'dark' });
    });
  });

  describe('updateForUser', () => {
    it('persists a dateFormat-only update and leaves themeMode as SQL NULL', async () => {
      const alice = await seedUser(prisma, { id: 'alice' });

      const result = await service.updateForUser(alice.id, {
        dateFormat: 'eu',
      });

      expect(result).toEqual({ dateFormat: 'eu', themeMode: null });
      // Read the raw User row — the service's return value could in
      // principle massage the shape, but the DB column must truly be
      // NULL for the "cleared" semantics to hold on the next read.
      const raw = await prisma.user.findUnique({
        where: { id: alice.id },
        select: { dateFormat: true, themeMode: true },
      });
      expect(raw).toEqual({ dateFormat: 'eu', themeMode: null });
    });

    it('persists a themeMode-only update and leaves dateFormat as SQL NULL', async () => {
      const alice = await seedUser(prisma, { id: 'alice' });

      const result = await service.updateForUser(alice.id, {
        themeMode: 'dark',
      });

      expect(result).toEqual({ dateFormat: null, themeMode: 'dark' });
    });

    it('writes both fields in one call — the localStorage → server promotion path', async () => {
      // Mirrors the first-sign-in promotion flow in SettingsContext:
      // an anonymous user who already picked prefs locally gets them
      // uploaded in a single PATCH on first sign-in.
      const alice = await seedUser(prisma, { id: 'alice' });

      const result = await service.updateForUser(alice.id, {
        dateFormat: 'us',
        themeMode: 'dark',
      });

      expect(result).toEqual({ dateFormat: 'us', themeMode: 'dark' });
    });

    it('overwrites one field without disturbing the other', async () => {
      // Partial-update semantics — the setter-level PATCHes send only
      // the field that changed. If Prisma's update ever stopped being
      // a partial write, every setter click would clobber the other
      // preference. This test guards that invariant.
      const alice = await seedUser(prisma, { id: 'alice' });
      await service.updateForUser(alice.id, {
        dateFormat: 'us',
        themeMode: 'dark',
      });

      await service.updateForUser(alice.id, { dateFormat: 'eu' });

      const after = await service.getForUser(alice.id);
      expect(after).toEqual({ dateFormat: 'eu', themeMode: 'dark' });
    });

    it('persists null to clear a previously-set preference', async () => {
      const alice = await seedUser(prisma, { id: 'alice' });
      await service.updateForUser(alice.id, { dateFormat: 'us' });

      await service.updateForUser(alice.id, { dateFormat: null });

      const raw = await prisma.user.findUnique({
        where: { id: alice.id },
        select: { dateFormat: true, themeMode: true },
      });
      // Prisma writes JS null as SQL NULL — the "cleared" state the
      // client's fall-back-to-defaults branch expects to see.
      expect(raw).toEqual({ dateFormat: null, themeMode: null });
    });

    it("strips unknown fields so a malicious PATCH can't touch other User columns", async () => {
      // Security guard — the Zod schema whitelists only dateFormat and
      // themeMode; any other key must be dropped before Prisma sees it.
      // The attack vector that matters is a real User column (email,
      // id) because an unknown key would just error at Prisma; a column
      // name would silently update if the strip ever regressed.
      const alice = await seedUser(prisma, { id: 'alice' });
      const emailBefore = alice.email;

      await service.updateForUser(alice.id, {
        dateFormat: 'us',
        email: 'attacker@example.com',
        isAdmin: true,
      });

      const raw = await prisma.user.findUnique({ where: { id: alice.id } });
      // Whitelisted field: written.
      expect(raw?.dateFormat).toBe('us');
      // Attack vector: email untouched, proving the strip reaches Prisma.
      expect(raw?.email).toBe(emailBefore);
    });

    it('rejects an invalid dateFormat with ZodError before touching the DB', async () => {
      const alice = await seedUser(prisma, { id: 'alice' });

      await expect(
        service.updateForUser(alice.id, { dateFormat: 'european' }),
      ).rejects.toBeInstanceOf(ZodError);

      // Row untouched — no half-applied state.
      const raw = await prisma.user.findUnique({
        where: { id: alice.id },
        select: { dateFormat: true, themeMode: true },
      });
      expect(raw).toEqual({ dateFormat: null, themeMode: null });
    });

    it('rejects an empty PATCH payload with ZodError', async () => {
      const alice = await seedUser(prisma, { id: 'alice' });

      await expect(service.updateForUser(alice.id, {})).rejects.toBeInstanceOf(
        ZodError,
      );
    });

    it("wraps Prisma's P2025 (record not found) as SettingsServiceError when the user doesn't exist", async () => {
      // No seedUser — Prisma's update targets a non-existent id and
      // throws PrismaClientKnownRequestError with code P2025. The
      // service's try/catch must wrap it as SettingsServiceError so
      // apiErrorResponse can serialise it to a stable 500 shape.
      // The auth gate at the route layer makes this an
      // "shouldn't normally happen" path, but a stale-session edge
      // case can hit it and we don't want a raw Prisma error leaking
      // through.
      await expect(
        service.updateForUser('ghost', { dateFormat: 'us' }),
      ).rejects.toBeInstanceOf(SettingsServiceError);
    });
  });
});
