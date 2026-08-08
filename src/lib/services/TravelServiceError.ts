import { CodedServiceError, type DomainCodes } from './CodedServiceError';
import type { ServiceErrorCode } from './ServiceError';

export type TravelServiceErrorCode =
  | ServiceErrorCode
  | 'CITY_NOT_FOUND'
  | 'AIRPORT_NOT_FOUND'
  | 'INVALID_DATE_RANGE';

// Single error class shared by flights and hotels, since the
// TravelService API is a single service that can return errors from
// either domain.
export class TravelServiceError extends CodedServiceError<TravelServiceErrorCode> {
  protected readonly logPrefix = 'travel';
  protected readonly statusByCode: Record<
    DomainCodes<TravelServiceErrorCode>,
    number
  > = {
    CITY_NOT_FOUND: 404,
    AIRPORT_NOT_FOUND: 404,
    INVALID_DATE_RANGE: 400,
  };
}
