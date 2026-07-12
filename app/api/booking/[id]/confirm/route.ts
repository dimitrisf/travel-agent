import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/utils/apiErrorResponse';
import { createBookingService } from '@/lib';

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
// This endpoint is called by the browser when the user clicks "Confirm" on a
// proposed-booking card in the chat UI — NOT by the agent. Confirmation is a
// user action, not a model action.
export async function POST(_req: NextRequest, ctx: RouteContext) {
  const { id: idParam } = await ctx.params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json(
      { error: 'Invalid booking id.' },
      { status: 400 },
    );
  }
  try {
    const booking = await bookingService.confirmBooking(id);
    return NextResponse.json(booking);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
