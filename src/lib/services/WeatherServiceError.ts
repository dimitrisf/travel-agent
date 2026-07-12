export type WeatherServiceErrorCode =
  | 'CITY_NOT_FOUND'
  | 'NO_FORECAST_AVAILABLE'
  | 'INTERNAL_ERROR';

export class WeatherServiceError extends Error {
  readonly code: WeatherServiceErrorCode;

  constructor(
    message: string,
    code: WeatherServiceErrorCode,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'WeatherServiceError';
    this.code = code;
  }
}
