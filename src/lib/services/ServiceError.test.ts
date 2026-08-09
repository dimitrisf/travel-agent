import { describe, it, expect } from 'vitest';
import type { NextResponse } from 'next/server';
import { ServiceError } from './ServiceError';

// Concrete stub subclass just for exercising the abstract base — we
// only care about the auto-name behaviour, not toApiResponse.
class TestServiceError extends ServiceError {
  toApiResponse(): NextResponse {
    // Not used by these tests.
    throw new Error('not implemented');
  }
}

// A subclass with a different name to prove the auto-name reflects
// the *actual* constructor invoked with new, not something baked in.
class AnotherServiceError extends ServiceError {
  toApiResponse(): NextResponse {
    throw new Error('not implemented');
  }
}

describe('ServiceError', () => {
  it('auto-populates .name from the concrete subclass name', () => {
    const err = new TestServiceError('boom');
    expect(err.name).toBe('TestServiceError');
  });

  it('.name reflects the actual constructor invoked with `new`', () => {
    const err1 = new TestServiceError('one');
    const err2 = new AnotherServiceError('two');
    expect(err1.name).toBe('TestServiceError');
    expect(err2.name).toBe('AnotherServiceError');
  });

  it('inherits Error.message from super()', () => {
    const err = new TestServiceError('kaboom');
    expect(err.message).toBe('kaboom');
  });

  it('passes options.cause through to the underlying Error', () => {
    const cause = new Error('root cause');
    const err = new TestServiceError('wrapped', { cause });
    expect(err.cause).toBe(cause);
  });

  it('is an instanceof Error and ServiceError', () => {
    const err = new TestServiceError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ServiceError);
  });
});
