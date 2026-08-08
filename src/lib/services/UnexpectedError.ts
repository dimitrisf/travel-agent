import { NextResponse } from 'next/server';
import { ServiceError } from './ServiceError';

// Default-branch classifier target: any thrown value that reaches
// apiErrorResponse but is neither a ServiceError nor a ZodError becomes
// this. Yields an opaque 500 to the client and logs the raw cause
// server-side so bugs, foreign-library errors, and null-derefs are
// still debuggable.
export class UnexpectedError extends ServiceError {
  constructor(cause: unknown) {
    super('Internal server error.', { cause });
  }

  toApiResponse(): NextResponse {
    console.error('[api] unexpected error:', this.cause ?? this);
    return NextResponse.json({ error: this.message }, { status: 500 });
  }
}
