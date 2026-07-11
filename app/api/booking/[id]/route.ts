import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/lib/apiErrorResponse';
import { createBookingService } from '@/lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bookingService = createBookingService();

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/booking/[id]
//
// Returns a single booking with all relations. 404 if not found.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { id: idParam } = await ctx.params;
  const id = Number(idParam);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json(
      { error: 'Invalid booking id.' },
      { status: 400 },
    );
  }
  try {
    const booking = await bookingService.getBooking(id);
    return NextResponse.json(booking);
  } catch (err) {
    return apiErrorResponse(err);
  }
}
