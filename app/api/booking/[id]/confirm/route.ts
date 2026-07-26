import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/utils/apiErrorResponse';
import { createBookingService } from '@/lib';
import { getCurrentUser } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bookingService = createBookingService();

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/booking/[id]/confirm
//
// Transitions a PROPOSED booking to PAID: reserves inventory (flight seats +
// hotel rooms night-by-night) and records a stub Payment as SUCCEEDED, all in
// one transaction. If any inventory check fails, the whole thing rolls back
// and the booking stays PROPOSED.
//
// Auth (Stage 17 Phase 2): REQUIRED. Confirm is the point at which anonymous
// proposals get claimed — we need an authenticated identity to write the
// row's owner. 401 (not redirect) so the BookingCard client can react
// gracefully; the Confirm button pre-flights auth state and triggers OAuth
// before hitting this endpoint.
export async function POST(_req: NextRequest, ctx: RouteContext) {
  const { id: idParam } = await ctx.params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid booking id.' }, { status: 400 });
  }

  // Get the current user. If not signed in, return 401 (not redirect) so the BookingCard client can react gracefully; the Confirm button pre-flights auth state and triggers OAuth before hitting this endpoint.
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Sign in required to confirm a booking.', code: 'UNAUTHORIZED' },
      { status: 401 },
    );
  }

  try {
    const booking = await bookingService.confirmBooking(id, {
      id: user.id,
      name: user.name,
      email: user.email,
    });
    return NextResponse.json(booking);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
