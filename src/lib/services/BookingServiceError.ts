import { CodedServiceError, type DomainCodes } from './CodedServiceError';
import type { ServiceErrorCode } from './ServiceError';

export type BookingServiceErrorCode =
  | ServiceErrorCode
  | 'BOOKING_NOT_FOUND'
  | 'INVALID_STATE'
  | 'FLIGHT_INSTANCE_NOT_FOUND'
  | 'ROOM_TYPE_NOT_FOUND'
  | 'INSUFFICIENT_SEATS'
  | 'INSUFFICIENT_ROOMS'
  | 'NON_REFUNDABLE';

export class BookingServiceError extends CodedServiceError<BookingServiceErrorCode> {
  protected readonly logPrefix = 'booking';
  protected readonly statusByCode: Record<
    DomainCodes<BookingServiceErrorCode>,
    number
  > = {
    BOOKING_NOT_FOUND: 404,
    FLIGHT_INSTANCE_NOT_FOUND: 404,
    ROOM_TYPE_NOT_FOUND: 404,
    // 409 Conflict — request is well-formed but conflicts with current state
    INVALID_STATE: 409,
    NON_REFUNDABLE: 409,
    INSUFFICIENT_SEATS: 409,
    INSUFFICIENT_ROOMS: 409,
  };
}
