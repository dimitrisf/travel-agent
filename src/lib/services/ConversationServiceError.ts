// Typed error class for the conversation persistence layer. Mirrors the
// shape of BookingServiceError / WeatherServiceError so the API-error
// mapper (utils/apiErrorResponse) handles all three uniformly.
export type ConversationServiceErrorCode =
  | 'CONVERSATION_NOT_FOUND'
  | 'INTERNAL_ERROR';

export class ConversationServiceError extends Error {
  readonly code: ConversationServiceErrorCode;

  constructor(
    // The error message to be returned to the client
    message: string,
    // The error code to be returned to the client
    code: ConversationServiceErrorCode,
    // Optional error options to be passed to the Error constructor, e.g., { cause: someError }
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ConversationServiceError';
    this.code = code;
  }
}
