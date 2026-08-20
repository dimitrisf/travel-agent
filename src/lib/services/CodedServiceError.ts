import { NextResponse } from 'next/server';
import { ServiceError, type ServiceErrorCode } from './ServiceError';

// The codes in a domain TCode union that are NOT shared across every
// CodedServiceError (i.e. not in ServiceErrorCode). Subclasses only
// need to provide statusByCode entries for these; shared codes get
// their statuses from SHARED_STATUS_BY_CODE below.
export type DomainCodes<T extends string> = Exclude<T, ServiceErrorCode>;

// Intermediate base for the four domain error classes (Weather / Travel
// / Booking / Conversation). All of them share:
//   - a `code` field of a domain-specific union type
//   - a `{ error, code }` response body
//   - a log line when code === 'INTERNAL_ERROR'
//   - a 500 status for INTERNAL_ERROR
//
// The template-method toApiResponse() here handles all of that;
// subclasses only declare the two pieces that vary: `logPrefix` and
// `statusByCode` (domain-specific codes only — INTERNAL_ERROR and any
// future shared codes are handled by the base).
//
// ZodValidationError and UnexpectedError skip this layer because their
// response bodies have different shapes ({ error, issues } and
// { error } respectively).
export abstract class CodedServiceError<
  TCode extends string,
> extends ServiceError {
  readonly code: TCode;

  constructor(message: string, code: TCode, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }

  // The short tag used in "[weather] internal error:" style log lines.
  protected abstract readonly logPrefix: string;

  // Exhaustive HTTP-status mapping for every DOMAIN code in TCode.
  // Shared codes (see SHARED_STATUS_BY_CODE) are excluded — including
  // INTERNAL_ERROR here is a type error, since the base owns it.
  // Using Record<DomainCodes<TCode>, number> (not Partial<>) means the
  // compiler flags any new domain code added to the union that hasn't
  // been assigned a status.
  protected abstract readonly statusByCode: Record<DomainCodes<TCode>, number>;

  // Statuses for codes shared across every CodedServiceError subclass.
  // Hoisted here so INTERNAL_ERROR: 500 lives in one place rather than
  // duplicated across every subclass. Same exhaustive-Record<>
  // discipline as the subclass maps — adding a new ServiceErrorCode
  // value forces adding its status here at compile time.
  private static readonly SHARED_STATUS_BY_CODE: Record<
    ServiceErrorCode,
    number
  > = {
    INTERNAL_ERROR: 500,
  };

  toApiResponse(): NextResponse {
    if (this.code === 'INTERNAL_ERROR') {
      console.error(
        `[${this.logPrefix}] internal error:`,
        this.message,
        this.cause ?? this,
      );
    }
    return NextResponse.json(
      { error: this.message, code: this.code },
      { status: this.resolveStatus() },
    );
  }

  // Two-arm lookup: shared codes first (base's map), then domain codes
  // (subclass's map). The `in` check keeps the shared arm robust to
  // future additions to ServiceErrorCode without changing this method.
  private resolveStatus(): number {
    if (this.code in CodedServiceError.SHARED_STATUS_BY_CODE) {
      return CodedServiceError.SHARED_STATUS_BY_CODE[
        this.code as ServiceErrorCode
      ];
    }
    return this.statusByCode[this.code as DomainCodes<TCode>];
  }
}

// Given a CodedServiceError subclass, return a helper that wraps an
// arbitrary `cause` (typically a Prisma / repo failure) into that
// subclass with code 'INTERNAL_ERROR'. Extracts the boilerplate of the
// service-layer pattern:
//
//   try { ... } catch (err) { throw internal('...', err); }
//
// Usage: `const internal = internalErrorFactory(BookingServiceError);`
// once at module scope, then `throw internal(msg, err)` at each call
// site.
//
// The `'INTERNAL_ERROR' as TCode` cast is safe by construction: every
// CodedServiceError subclass's TCode extends ServiceErrorCode (which is
// exactly 'INTERNAL_ERROR'), so the literal is always assignable —
// TypeScript just can't express "TCode must be a superset of X" as a
// constraint, so the cast bridges what the type system won't.
export function internalErrorFactory<
  // E.g., BookingServiceErrorCode, ConversationServiceErrorCode, etc.
  TCode extends string,
  // E.g., BookingServiceError, ConversationServiceError, etc.
  TError extends CodedServiceError<TCode>,
>(
  // This is a constructor signature: new (...args) => TError. It says "give me anything I can invoke with new, that takes (message, code, options) and produces a TError". Every CodedServiceError subclass matches this shape — that's the contract the base class enforces via its own constructor.
  ErrorClass: new (
    message: string,
    code: TCode,
    options?: ErrorOptions,
  ) => TError,
): // Return a function that takes (message, cause) and returns a TError.
(message: string, cause: unknown) => TError {
  // Arrow function that closes over ErrorClass, hardcodes 'INTERNAL_ERROR' as the code, and packages cause into the ErrorOptions bag. Each call constructs a fresh TError instance.
  return (message, cause) =>
    new ErrorClass(
      message,
      // TCode is a broad union like 'INTERNAL_ERROR' | 'BOOKING_NOT_FOUND' | .... We know 'INTERNAL_ERROR' is always in that union (every CodedServiceError subclass's code type extends ServiceErrorCode, which is 'INTERNAL_ERROR'). But TypeScript can't express "TCode must include this specific literal" as a constraint — you can say TCode extends X (TCode is a subset of X) but not the reverse. So the cast bridges what the type system can't prove structurally.
      'INTERNAL_ERROR' as TCode,
      { cause },
    );
}
