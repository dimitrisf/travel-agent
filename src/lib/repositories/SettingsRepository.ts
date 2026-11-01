import type { PrismaClient } from '@prisma/client';

// Shape returned to the service layer. Nullable fields mirror the
// User-table columns — null means "not yet set, caller falls back to
// client defaults." Kept as a lightweight projection rather than
// returning the full User row so this file never has to grow a
// Prisma `select` the moment User gains a new column.
export type StoredSettings = {
  dateFormat: string | null;
  themeMode: string | null;
};

// Per-user preferences store. Backed by two nullable columns on the
// User table (added in migration 20261019191142_add_user_settings).
// Options-object constructor so adding another dependency later
// (cache, metrics, feature flags) doesn't become a breaking change
// at every call site.
export class SettingsRepository {
  private readonly prisma: PrismaClient;

  constructor(opts: { prisma: PrismaClient }) {
    this.prisma = opts.prisma;
  }

  // Returns the user's stored prefs, or null if the user doesn't exist.
  // A user with existing columns-both-null gets back { dateFormat: null,
  // themeMode: null } — distinct from "user not found" so the service
  // layer can decide the right fallback.
  async findByUserId(userId: string): Promise<StoredSettings | null> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { dateFormat: true, themeMode: true },
    });

    return row;
  }

  // Partial update — only fields the caller provides are written. Null
  // values are preserved as null (meaning "clear this preference"),
  // which is why the input shape uses optional-not-nullable semantics:
  // omit the key to leave the column alone; include `null` to clear it.
  async updateByUserId(
    userId: string,
    settings: Partial<StoredSettings>,
  ): Promise<StoredSettings> {
    const row = await this.prisma.user.update({
      where: { id: userId },
      data: settings,
      select: { dateFormat: true, themeMode: true },
    });

    return row;
  }
}
