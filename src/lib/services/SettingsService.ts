import { z } from 'zod';
import type {
  SettingsRepository,
  StoredSettings,
} from '../repositories/SettingsRepository';
import { internalErrorFactory } from './CodedServiceError';
import { SettingsServiceError } from './SettingsServiceError';

// Zod schemas for the two preference values. Keeping them as narrow
// enums (not `string.optional()`) means an invalid write — e.g. a
// client bug sending `dateFormat: 'european'` — surfaces as a 400
// at the API boundary instead of silently writing garbage to the row.
const DateFormat = z.enum(['auto', 'us', 'eu']);
const ThemeMode = z.enum(['light', 'dark']);

// Patch shape used by the PATCH /api/settings endpoint. Each field is
// optional so the caller can touch one setting at a time; nullable so
// the caller can clear a preference back to "not set" (which falls
// through to client-side defaults on the next read).
const UpdateSettingsInput = z
  .object({
    dateFormat: DateFormat.nullable().optional(),
    themeMode: ThemeMode.nullable().optional(),
  })
  // At least one field must be present — an empty PATCH is a client
  // bug, not a legitimate operation, and silently accepting it would
  // mask reconnect/retry mistakes.
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one setting must be provided.',
  });

export type UpdateSettingsInput = z.infer<typeof UpdateSettingsInput>;

const internal = internalErrorFactory(SettingsServiceError);

export class SettingsService {
  private readonly repo: SettingsRepository;

  constructor(opts: { repo: SettingsRepository }) {
    this.repo = opts.repo;
  }

  // Read the current prefs for a user. Returns the stored row (which may
  // have null fields meaning "not yet set") or null if the user doesn't
  // exist. The API route handler decides whether to coerce null-user
  // into a 404 or treat it as "signed-in user with empty prefs"; the
  // service layer stays unopinionated.
  async getForUser(userId: string): Promise<StoredSettings | null> {
    try {
      return await this.repo.findByUserId(userId);
    } catch (err) {
      throw internal('Failed to read user settings.', err);
    }
  }

  // Partial update. Validates input with Zod — unknown fields are
  // stripped by the schema (not forwarded to the DB), so a malicious
  // client can't PATCH arbitrary User columns through this endpoint.
  async updateForUser(
    userId: string,
    input: unknown,
  ): Promise<StoredSettings> {
    const parsed = UpdateSettingsInput.parse(input);
    try {
      return await this.repo.updateByUserId(userId, parsed);
    } catch (err) {
      throw internal('Failed to update user settings.', err);
    }
  }
}
