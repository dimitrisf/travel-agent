import { describe, it, expect, vi } from 'vitest';
import { CodedServiceError, type DomainCodes } from './CodedServiceError';
import type { ServiceErrorCode } from './ServiceError';

// Concrete subclass under test. Deliberately small — real subclasses
// (WeatherServiceError etc.) look exactly like this apart from the
// specific code union + status mapping.
type TestCode = ServiceErrorCode | 'A_NOT_FOUND' | 'B_CONFLICT';

class TestCodedError extends CodedServiceError<TestCode> {
  protected readonly logPrefix = 'test';
  protected readonly statusByCode: Record<DomainCodes<TestCode>, number> = {
    A_NOT_FOUND: 404,
    B_CONFLICT: 409,
  };
}

describe('CodedServiceError', () => {
  it('auto-names the concrete subclass', () => {
    const err = new TestCodedError('nope', 'A_NOT_FOUND');
    expect(err.name).toBe('TestCodedError');
  });

  it('exposes the code as a public readonly field', () => {
    const err = new TestCodedError('nope', 'A_NOT_FOUND');
    expect(err.code).toBe('A_NOT_FOUND');
  });

  it('toApiResponse() maps a domain code to the subclass status', async () => {
    const err = new TestCodedError('nope', 'A_NOT_FOUND');
    const response = err.toApiResponse();

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: 'nope', code: 'A_NOT_FOUND' });
  });

  it('toApiResponse() maps a different domain code to its own status', async () => {
    const err = new TestCodedError('conflict', 'B_CONFLICT');
    const response = err.toApiResponse();

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toEqual({ error: 'conflict', code: 'B_CONFLICT' });
  });

  it('toApiResponse() returns 500 for INTERNAL_ERROR (base owns the shared status)', async () => {
    // Base's SHARED_STATUS_BY_CODE holds INTERNAL_ERROR:500; the
    // subclass's statusByCode deliberately doesn't include it (the
    // Record<DomainCodes<TCode>, number> type forbids it).
    const err = new TestCodedError('internal boom', 'INTERNAL_ERROR');
    const response = err.toApiResponse();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: 'internal boom', code: 'INTERNAL_ERROR' });
  });

  it('toApiResponse() logs a "[prefix] internal error:" line for INTERNAL_ERROR', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const err = new TestCodedError('internal boom', 'INTERNAL_ERROR');
      err.toApiResponse();
      expect(spy).toHaveBeenCalledWith(
        '[test] internal error:',
        'internal boom',
        expect.anything(),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('toApiResponse() does NOT log for non-INTERNAL_ERROR codes', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const err = new TestCodedError('not found', 'A_NOT_FOUND');
      err.toApiResponse();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('preserves .cause through the constructor for downstream debugging', () => {
    const root = new Error('root');
    const err = new TestCodedError('internal', 'INTERNAL_ERROR', {
      cause: root,
    });
    expect(err.cause).toBe(root);
  });
});
