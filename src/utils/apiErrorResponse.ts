import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ServiceError,
  UnexpectedError,
  ZodValidationError,
} from '@/lib';

// Turns any thrown value into an HTTP response. All the per-error
// mapping (status code, body shape, side-effect logging) lives on each
// ServiceError subclass's toApiResponse() — this function just
// classifies the incoming value into a ServiceError instance and lets
// polymorphism render it.
export function apiErrorResponse(err: unknown): NextResponse {
  return classify(err).toApiResponse();
}

// The one place the app crosses the boundary from "unknown thrown
// value" to "typed ServiceError we can polymorphically render." Two
// runtime branches:
//   - ZodError from a schema.parse() call → wrap in ZodValidationError
//   - anything else non-ServiceError      → wrap in UnexpectedError
// Anything already a ServiceError passes straight through.
function classify(err: unknown): ServiceError {
  if (err instanceof ServiceError) return err;
  if (err instanceof z.ZodError) return new ZodValidationError(err);
  return new UnexpectedError(err);
}
