import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';
import { ServiceError } from './ServiceError';

// Wraps a caught ZodError (from `schema.parse()`) so validation
// failures flow through the same toApiResponse() polymorphism as domain
// service errors. Constructed only by the classifier in
// apiErrorResponse — never thrown directly by service code.
export class ZodValidationError extends ServiceError {
  constructor(readonly zodError: ZodError) {
    super('Invalid request parameters.', { cause: zodError });
  }

  toApiResponse(): NextResponse {
    return NextResponse.json(
      { error: this.message, issues: this.zodError.issues },
      { status: 400 },
    );
  }
}
