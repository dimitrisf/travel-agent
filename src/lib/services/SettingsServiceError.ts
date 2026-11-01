import { CodedServiceError, type DomainCodes } from './CodedServiceError';
import type { ServiceErrorCode } from './ServiceError';

// Settings doesn't need any domain-specific error codes right now —
// the operations are idempotent "get the row" / "patch the row" and
// the only genuine failure modes are "DB down" (INTERNAL_ERROR) and
// "user doesn't exist" (which also maps to INTERNAL_ERROR because
// the auth-gated route guarantees the user exists before this layer
// is called). The empty domain-codes record keeps the shape ready
// for future codes (e.g., SETTINGS_QUOTA_EXCEEDED) without needing
// a schema change.
export type SettingsServiceErrorCode = ServiceErrorCode;

export class SettingsServiceError extends CodedServiceError<SettingsServiceErrorCode> {
  protected readonly logPrefix = 'settings';
  protected readonly statusByCode: Record<
    DomainCodes<SettingsServiceErrorCode>,
    number
  > = {};
}
