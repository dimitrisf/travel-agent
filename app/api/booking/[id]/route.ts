import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/utils/apiErrorResponse';
import { createBookingService } from '@/lib';
import { getCurrentUser } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bookingService = createBookingService();

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/booking/[id]
//
// Returns a single booking with all relations. Cross-tenant requests get
// 404 (Stage 17 Phase 2) — same shape as truly-missing so ids can't be
// enumerated across accounts.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id: idParam } = await ctx.params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid booking id.' }, { status: 400 });
  }

  // Get the current user (if any) so we can pass their id to the service layer for cross-tenant checks.
  const user = await getCurrentUser();
  try {
    const booking = await bookingService.getBooking(id, {
      currentUserId: user?.id ?? null,
    });

    return NextResponse.json(booking);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
