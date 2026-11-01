import { describe, it, expect, vi } from 'vitest';
import { ZodError } from 'zod';
import { SettingsService } from './SettingsService';
import { SettingsServiceError } from './SettingsServiceError';
import type { SettingsRepository } from '../repositories/SettingsRepository';

function makeMockRepo() {
  const mocks = {
    findByUserId: vi.fn(),
    updateByUserId: vi.fn(),
  };
  return {
    repo: mocks as unknown as SettingsRepository,
    mocks,
  };
}

describe('SettingsService', () => {
  describe('getForUser', () => {
    it('returns the stored settings for an existing user', async () => {
      const { repo, mocks } = makeMockRepo();
      mocks.findByUserId.mockResolvedValue({
        dateFormat: 'eu',
        themeMode: 'dark',
      });
      const svc = new SettingsService({ repo });

      expect(await svc.getForUser('user-1')).toEqual({
        dateFormat: 'eu',
        themeMode: 'dark',
      });
      expect(mocks.findByUserId).toHaveBeenCalledWith('user-1');
    });

    it('returns null when the repo returns null (user not found)', async () => {
      const { repo, mocks } = makeMockRepo();
      mocks.findByUserId.mockResolvedValue(null);
      const svc = new SettingsService({ repo });

      expect(await svc.getForUser('ghost')).toBeNull();
    });

    it('wraps repo errors as INTERNAL_ERROR so the API layer can serialize them', async () => {
      const { repo, mocks } = makeMockRepo();
      mocks.findByUserId.mockRejectedValue(new Error('DB down'));
      const svc = new SettingsService({ repo });

      await expect(svc.getForUser('user-1')).rejects.toBeInstanceOf(
        SettingsServiceError,
      );
    });
  });

  describe('updateForUser', () => {
    it('accepts a valid dateFormat-only update and forwards it to the repo', async () => {
      const { repo, mocks } = makeMockRepo();
      mocks.updateByUserId.mockResolvedValue({
        dateFormat: 'us',
        themeMode: null,
      });
      const svc = new SettingsService({ repo });

      const result = await svc.updateForUser('user-1', { dateFormat: 'us' });

      expect(result).toEqual({ dateFormat: 'us', themeMode: null });
      expect(mocks.updateByUserId).toHaveBeenCalledWith('user-1', {
        dateFormat: 'us',
      });
    });

    it('accepts a valid themeMode-only update', async () => {
      const { repo, mocks } = makeMockRepo();
      mocks.updateByUserId.mockResolvedValue({
        dateFormat: 'auto',
        themeMode: 'dark',
      });
      const svc = new SettingsService({ repo });

      await svc.updateForUser('user-1', { themeMode: 'dark' });

      expect(mocks.updateByUserId).toHaveBeenCalledWith('user-1', {
        themeMode: 'dark',
      });
    });

    it('accepts both fields in one call', async () => {
      const { repo, mocks } = makeMockRepo();
      mocks.updateByUserId.mockResolvedValue({
        dateFormat: 'eu',
        themeMode: 'dark',
      });
      const svc = new SettingsService({ repo });

      await svc.updateForUser('user-1', { dateFormat: 'eu', themeMode: 'dark' });

      expect(mocks.updateByUserId).toHaveBeenCalledWith('user-1', {
        dateFormat: 'eu',
        themeMode: 'dark',
      });
    });

    it('accepts null to clear a preference', async () => {
      const { repo, mocks } = makeMockRepo();
      mocks.updateByUserId.mockResolvedValue({
        dateFormat: null,
        themeMode: 'light',
      });
      const svc = new SettingsService({ repo });

      await svc.updateForUser('user-1', { dateFormat: null });

      expect(mocks.updateByUserId).toHaveBeenCalledWith('user-1', {
        dateFormat: null,
      });
    });

    it('rejects an invalid dateFormat value with ZodError (so the route returns 400)', async () => {
      const { repo } = makeMockRepo();
      const svc = new SettingsService({ repo });

      // 'european' isn't one of 'auto' | 'us' | 'eu' — the schema's
      // z.enum catches it before the repo is touched.
      await expect(
        svc.updateForUser('user-1', { dateFormat: 'european' }),
      ).rejects.toBeInstanceOf(ZodError);
    });

    it('rejects an invalid themeMode value', async () => {
      const { repo } = makeMockRepo();
      const svc = new SettingsService({ repo });

      await expect(
        svc.updateForUser('user-1', { themeMode: 'sepia' }),
      ).rejects.toBeInstanceOf(ZodError);
    });

    it('rejects an empty object — no setting provided is a client bug', async () => {
      const { repo } = makeMockRepo();
      const svc = new SettingsService({ repo });

      await expect(svc.updateForUser('user-1', {})).rejects.toBeInstanceOf(
        ZodError,
      );
    });

    it('strips unknown fields rather than writing them to the DB', async () => {
      // A malicious client might try to PATCH `isAdmin: true` or
      // another User column — the schema should drop it silently
      // rather than forward it to Prisma.
      const { repo, mocks } = makeMockRepo();
      mocks.updateByUserId.mockResolvedValue({
        dateFormat: 'us',
        themeMode: null,
      });
      const svc = new SettingsService({ repo });

      await svc.updateForUser('user-1', {
        dateFormat: 'us',
        isAdmin: true,
      });

      expect(mocks.updateByUserId).toHaveBeenCalledWith('user-1', {
        dateFormat: 'us',
      });
    });

    it('wraps repo errors as INTERNAL_ERROR', async () => {
      const { repo, mocks } = makeMockRepo();
      mocks.updateByUserId.mockRejectedValue(new Error('DB down'));
      const svc = new SettingsService({ repo });

      await expect(
        svc.updateForUser('user-1', { dateFormat: 'us' }),
      ).rejects.toBeInstanceOf(SettingsServiceError);
    });
  });
});
