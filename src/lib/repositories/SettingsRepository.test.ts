import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { SettingsRepository } from './SettingsRepository';

// Minimal shape-partial Prisma mock — only the user model's two
// methods the SettingsRepository actually touches. Cast through
// unknown so TS accepts the partial as a full PrismaClient.
function makeMockPrisma() {
  const prisma = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  return { prisma: prisma as unknown as PrismaClient, mocks: prisma };
}

describe('SettingsRepository', () => {
  describe('findByUserId', () => {
    it('returns the stored prefs when the user row exists', async () => {
      const { prisma, mocks } = makeMockPrisma();
      mocks.user.findUnique.mockResolvedValue({
        dateFormat: 'eu',
        themeMode: 'dark',
      });
      const repo = new SettingsRepository({ prisma });

      const result = await repo.findByUserId('user-1');

      expect(result).toEqual({ dateFormat: 'eu', themeMode: 'dark' });
      expect(mocks.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { dateFormat: true, themeMode: true },
      });
    });

    it('returns null when the user does not exist', async () => {
      const { prisma, mocks } = makeMockPrisma();
      mocks.user.findUnique.mockResolvedValue(null);
      const repo = new SettingsRepository({ prisma });

      expect(await repo.findByUserId('ghost')).toBeNull();
    });

    it('returns the row with null fields for a user who has never set prefs', async () => {
      // Existing users pre-date the Settings feature — their row has
      // dateFormat=null and themeMode=null. The service layer uses
      // this nullable-fields shape to detect "signed-in but empty"
      // and run the promotion-from-localStorage flow.
      const { prisma, mocks } = makeMockPrisma();
      mocks.user.findUnique.mockResolvedValue({
        dateFormat: null,
        themeMode: null,
      });
      const repo = new SettingsRepository({ prisma });

      expect(await repo.findByUserId('fresh-user')).toEqual({
        dateFormat: null,
        themeMode: null,
      });
    });
  });

  describe('updateByUserId', () => {
    it('writes only the fields the caller provided (partial update)', async () => {
      const { prisma, mocks } = makeMockPrisma();
      mocks.user.update.mockResolvedValue({
        dateFormat: 'us',
        themeMode: 'dark',
      });
      const repo = new SettingsRepository({ prisma });

      const result = await repo.updateByUserId('user-1', { dateFormat: 'us' });

      expect(result).toEqual({ dateFormat: 'us', themeMode: 'dark' });
      // The data object passed to Prisma mirrors the partial input —
      // only `dateFormat` was requested, so only `dateFormat` is
      // written. themeMode untouched on the row.
      expect(mocks.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { dateFormat: 'us' },
        select: { dateFormat: true, themeMode: true },
      });
    });

    it('propagates null to clear a preference back to "not set"', async () => {
      // Null is distinct from "undefined / omitted" — null means
      // "clear this column back to its default-fallthrough state."
      const { prisma, mocks } = makeMockPrisma();
      mocks.user.update.mockResolvedValue({
        dateFormat: null,
        themeMode: 'light',
      });
      const repo = new SettingsRepository({ prisma });

      await repo.updateByUserId('user-1', { dateFormat: null });

      expect(mocks.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { dateFormat: null },
        select: { dateFormat: true, themeMode: true },
      });
    });
  });
});
