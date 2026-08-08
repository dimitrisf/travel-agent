import { CodedServiceError, type DomainCodes } from './CodedServiceError';
import type { ServiceErrorCode } from './ServiceError';

export type WeatherServiceErrorCode =
  | ServiceErrorCode
  | 'CITY_NOT_FOUND'
  | 'NO_FORECAST_AVAILABLE';

export class WeatherServiceError extends CodedServiceError<WeatherServiceErrorCode> {
  protected readonly logPrefix = 'weather';
  protected readonly statusByCode: Record<
    DomainCodes<WeatherServiceErrorCode>,
    number
  > = {
    CITY_NOT_FOUND: 404,
    NO_FORECAST_AVAILABLE: 404,
  };
}
