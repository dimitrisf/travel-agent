import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/utils/apiErrorResponse';
import { createBookingService } from '@/lib';
import { getCurrentUser } from '@/lib/auth/session';

// runtime and dynamic settings for Next.js API route
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bookingService = createBookingService();

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/booking/[id]/cancel
//
// Cancels a PROPOSED, CONFIRMED, or PAID booking. For PAID/CONFIRMED bookings,
// enforces per-hotel `CancellationPolicy.freeCancellation` — any non-refundable
// leg causes the whole cancellation to fail. When allowed, restores inventory
// (flight seats + hotel rooms) and marks payments REFUNDED, all in one
// transaction.
//
// Auth (Stage 17 Phase 2): NOT strictly required. Anon PROPOSED bookings can
// be cancelled by anyone with the id (id itself is the only credential —
// see the Stage 17 design notes). Owned rows can only be cancelled by their
// owner; cross-tenant requests get 404 from the service layer.
//
// Body: optional { reason?: string }.
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { id: idParam } = await ctx.params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Invalid booking id.' }, { status: 400 });
  }

  // Reason is optional. Accept empty body, missing key, or a plain string.
  let reason: string | undefined;
  try {
    const body = (await req.json()) as { reason?: unknown };
    if (typeof body?.reason === 'string') reason = body.reason;
  } catch {
    // No JSON body — that's fine for an optional field.
  }

  const user = await getCurrentUser();

  try {
    const booking = await bookingService.cancelBooking(id, {
      currentUserId: user?.id ?? null,
      reason,
    });

    return NextResponse.json(booking);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
