import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/utils/apiErrorResponse';
import { createBookingService, type ProposeBookingInput } from '@/lib';

// runtime and dynamic settings for Next.js API route
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bookingService = createBookingService();

// POST /api/booking/propose
//
// Creates a booking in PROPOSED status. Idempotent on the caller-supplied
// `idempotency_key`: a retry with the same key returns the existing row
// verbatim rather than creating a duplicate.
//
// Body shape: ProposeBookingInput — customer info + flights[] + hotels[].
// Returns: BookingWithRelations (the fully populated Booking aggregate).
export async function POST(req: NextRequest) {
  try {
    const input = (await req.json()) as ProposeBookingInput;
    const booking = await bookingService.proposeBooking(input);
    return NextResponse.json(booking, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
