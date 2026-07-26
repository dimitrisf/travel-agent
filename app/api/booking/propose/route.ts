import { NextRequest, NextResponse } from 'next/server';
import { apiErrorResponse } from '@/utils/apiErrorResponse';
import { createBookingService, type ProposeBookingInput } from '@/lib';
import { getCurrentUser } from '@/lib/auth/session';

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
// Auth (Stage 17 Phase 2): NOT required. Anonymous users can propose — the
// row's userId/customerName/customerEmail stay null and get filled at
// Confirm time. If the caller IS signed in, we override any name/email
// from the body with the session identity so the agent can't spoof
// customer info via the MCP tool.
export async function POST(req: NextRequest) {
  try {
    const raw = (await req.json()) as ProposeBookingInput;
    // Get the current user (if any) so we can override any name/email from the body with the session identity. If the user is not signed in, we leave those fields null so the booking stays truly anonymous until someone signs in and confirms.
    const user = await getCurrentUser();

    const input: ProposeBookingInput = user
      ? // If the user is signed in, override any name/email from the body with the session identity so the agent can't spoof customer info via the MCP tool.
        {
          ...raw,
          user_id: user.id,
          customer_name: user.name ?? user.email,
          customer_email: user.email,
        }
      : {
          ...raw,
          // Strip any agent-supplied identity fields — anon proposals stay
          // truly anonymous until someone signs in and confirms.
          user_id: undefined,
          customer_name: undefined,
          customer_email: undefined,
        };
    const booking = await bookingService.proposeBooking(input);
    return NextResponse.json(booking, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err);
  }
}
