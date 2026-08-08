import { CodedServiceError, type DomainCodes } from './CodedServiceError';
import type { ServiceErrorCode } from './ServiceError';

export type ConversationServiceErrorCode =
  | ServiceErrorCode
  | 'CONVERSATION_NOT_FOUND';

export class ConversationServiceError extends CodedServiceError<ConversationServiceErrorCode> {
  protected readonly logPrefix = 'conversation';
  protected readonly statusByCode: Record<
    DomainCodes<ConversationServiceErrorCode>,
    number
  > = {
    CONVERSATION_NOT_FOUND: 404,
  };
}
