import { NextResponse } from 'next/server';
import {
  isBookingServiceError,
  isConversationServiceError,
  isTravelServiceError,
  isWeatherServiceError,
  isZodValidationError,
} from '@/lib';

// This function takes an error object and returns a NextResponse with the appropriate HTTP status code and JSON body based on the type of error. It handles validation errors, service-specific errors, and unexpected errors.
// The function uses type guards to determine the type of error and constructs a response accordingly. For validation errors, it returns a 400 status with details about the issues. For service-specific errors, it returns a 404 or 500 status based on the error code. For unexpected errors, it logs the error and returns a 500 status with a generic message.
export function apiErrorResponse(err: unknown): NextResponse {
  if (isZodValidationError(err)) {
    return NextResponse.json(
      { error: 'Invalid request parameters.', issues: err.issues },
      { status: 400 },
    );
  }

  if (isWeatherServiceError(err)) {
    const status =
      err.code === 'CITY_NOT_FOUND' || err.code === 'NO_FORECAST_AVAILABLE'
        ? 404
        : 500;
    // For INTERNAL_ERROR the underlying cause is buried in `.cause` — surface
    // it in the server log so intermittent failures leave a stack trace
    // behind (see also the booking branch below for the same pattern).
    if (err.code === 'INTERNAL_ERROR') {
      console.error('[weather] internal error:', err.message, err.cause ?? err);
    }
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status },
    );
  }

  if (isTravelServiceError(err)) {
    const status =
      err.code === 'AIRPORT_NOT_FOUND' || err.code === 'CITY_NOT_FOUND'
        ? 404
        : err.code === 'INVALID_DATE_RANGE'
          ? 400
          : 500;
    if (err.code === 'INTERNAL_ERROR') {
      console.error('[travel] internal error:', err.message, err.cause ?? err);
    }
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status },
    );
  }

  if (isBookingServiceError(err)) {
    const status =
      err.code === 'BOOKING_NOT_FOUND' ||
      err.code === 'FLIGHT_INSTANCE_NOT_FOUND' ||
      err.code === 'ROOM_TYPE_NOT_FOUND'
        ? 404
        : err.code === 'INVALID_STATE' || err.code === 'NON_REFUNDABLE'
          ? 409 // Conflict — request is well-formed but conflicts with current state
          : err.code === 'INSUFFICIENT_SEATS' || err.code === 'INSUFFICIENT_ROOMS'
            ? 409
            : 500;
    // For INTERNAL_ERROR we bury the underlying cause in `.cause` — surface it
    // in the server log so we can diagnose failures without losing them.
    if (err.code === 'INTERNAL_ERROR') {
      console.error('[booking] internal error:', err.message, err.cause ?? err);
    }
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status },
    );
  }

  if (isConversationServiceError(err)) {
    const status = err.code === 'CONVERSATION_NOT_FOUND' ? 404 : 500;
    if (err.code === 'INTERNAL_ERROR') {
      console.error(
        '[conversation] internal error:',
        err.message,
        err.cause ?? err,
      );
    }
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status },
    );
  }

  console.error('[api] unexpected error:', err);
  return NextResponse.json(
    { error: 'Internal server error.' },
    { status: 500 },
  );
}
