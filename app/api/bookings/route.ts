import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/utils/apiErrorResponse';
import { createBookingService } from '@/lib';
import { getCurrentUser } from '@/lib/auth/session';

// This tells Next.js to execute the handler in the full Node.js runtime rather than the slim Edge Runtime.
// Why this route needs 'nodejs':
// - Prisma needs the Node runtime — it ships a native query engine (or uses Node-only connection pooling) that the Edge Runtime can't load.
// - NextAuth session reads often rely on Node crypto / cookie handling that doesn't translate cleanly to Edge.
export const runtime = 'nodejs';
// Render this route on every request, never cache it, never try to statically pre-generate it.
// This ensures that the API always returns fresh data and never serves stale cached responses.
// This is particularly important for booking data, where freshness is critical.
// Why this route needs 'force-dynamic':
// - It reads the session to figure out which user's bookings to return.
// - Caching a response and reusing it across requests would serve one user's bookings to another user — a correctness and privacy bug.
// - 'auto' would probably arrive at the same answer (the auth call reads cookies, which taints the route as dynamic), but "probably" isn't good enough for a user-scoped endpoint. 'force-dynamic' makes the guarantee explicit, so a refactor that moves the auth check into a helper or inverts control can't accidentally re-enable caching.
export const dynamic = 'force-dynamic';
// Why both together is a common pair for API routes
// For any endpoint that:
// - Touches the database via Prisma, and
// - Returns per-user or per-session data
// …this exact pair is the safe default. One pins where it runs; the other pins how often it runs. The combination says: "full Node runtime, every request, no shortcuts."

const bookingService = createBookingService();

// Cap the list at a reasonable ceiling so a very-large-inventory
// account never returns thousands of fully-included rows in one
// response. 10 is the demo default; 50 is enough headroom for a
// future "show more" toggle without loosening the ceiling.
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

// GET /api/bookings
//
// Returns the signed-in user's most recent bookings, capped at
// `?limit=N` (default 10, max 50), sorted by createdAt desc. Each
// element is the same fully-included BookingWithRelations shape that
// GET /api/booking/[id] returns, so the client can render a full
// BookingCard without a follow-up round-trip.
//
// Auth: required. Anon requests get 401 rather than an empty array
// because "unauthorized" and "authenticated with zero bookings" are
// meaningfully different states — collapsing both to `[]` would
// silently hide a sign-in prompt behind an empty-list UI.
//
// Anon PROPOSED rows (userId=null) are NOT included, even if the
// caller later signs in with the same session — those rows belong to
// nobody until a Confirm claims them. See BookingService.listBookingsForUser
// for the rationale.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const limitParam = req.nextUrl.searchParams.get('limit');
  const parsedLimit = limitParam ? Number(limitParam) : DEFAULT_LIMIT;
  const limit =
    Number.isInteger(parsedLimit) && parsedLimit > 0
      ? Math.min(parsedLimit, MAX_LIMIT)
      : DEFAULT_LIMIT;

  try {
    const bookings = await bookingService.listBookingsForUser(user.id, limit);

    return NextResponse.json(bookings);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
