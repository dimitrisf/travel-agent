import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/utils/apiErrorResponse';
import { createSettingsService } from '@/lib';
import { getCurrentUser } from '@/lib/auth/session';

// See app/api/bookings/route.ts for the long-form rationale on these
// two Route Segment Config exports. Short version: Prisma needs Node;
// per-user data must not be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const settingsService = createSettingsService();

// GET /api/settings
//
// Returns the signed-in user's current preferences — `{ dateFormat,
// themeMode }`, each nullable. Null means "the user hasn't picked a
// value yet"; the client falls back to its own DEFAULTS in that case.
//
// Auth: required. Anon callers get 401 rather than { dateFormat: null,
// themeMode: null } because those two states are meaningfully
// different — anon users read from localStorage; signed-in users with
// empty rows read defaults AND trigger the first-write promotion flow
// in SettingsContext.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  try {
    const settings = await settingsService.getForUser(user.id);
    // Shouldn't normally happen — the auth guard above means the user
    // row exists — but defensive: return nulls rather than 500 so the
    // client's fallback-to-defaults path still works.
    return NextResponse.json(settings ?? { dateFormat: null, themeMode: null });
  } catch (err) {
    return apiErrorResponse(err);
  }
}

// PATCH /api/settings
//
// Updates one or more preferences for the signed-in user. Body: a JSON
// object with optional `dateFormat` and `themeMode` keys. Each key can
// be a valid literal or `null` (clears the preference back to "not
// set"). Returns the fresh row after the update.
//
// Auth: required (401 for anon). Validation happens inside the service
// via Zod — unknown fields are stripped before hitting the DB, so this
// endpoint can't be used to PATCH arbitrary User columns.
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  try {
    const body = (await req.json()) as unknown;
    const updated = await settingsService.updateForUser(user.id, body);
    return NextResponse.json(updated);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
