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
