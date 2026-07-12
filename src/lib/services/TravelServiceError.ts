export type TravelServiceErrorCode =
  | 'CITY_NOT_FOUND'
  | 'AIRPORT_NOT_FOUND'
  | 'INVALID_DATE_RANGE'
  | 'INTERNAL_ERROR';

// Single error class shared by flights and hotels, since the TravelService API is a single service that can return errors from either domain.
export class TravelServiceError extends Error {
  readonly code: TravelServiceErrorCode;

  constructor(
    message: string,
    code: TravelServiceErrorCode,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'TravelServiceError';
    this.code = code;
  }
}
