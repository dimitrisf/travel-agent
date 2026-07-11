export type BookingServiceErrorCode =
  | 'BOOKING_NOT_FOUND'
  | 'INVALID_STATE'
  | 'FLIGHT_INSTANCE_NOT_FOUND'
  | 'ROOM_TYPE_NOT_FOUND'
  | 'INSUFFICIENT_SEATS'
  | 'INSUFFICIENT_ROOMS'
  | 'NON_REFUNDABLE'
  | 'INTERNAL_ERROR';

export class BookingServiceError extends Error {
  readonly code: BookingServiceErrorCode;

  constructor(
    message: string,
    code: BookingServiceErrorCode,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'BookingServiceError';
    this.code = code;
  }
}
