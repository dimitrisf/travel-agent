import { describe, it, expect, vi } from 'vitest';
import { UnexpectedError } from './UnexpectedError';
import { ServiceError } from './ServiceError';

describe('UnexpectedError', () => {
  it('is an instance of ServiceError', () => {
    const err = new UnexpectedError('anything');
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.name).toBe('UnexpectedError');
  });

  it('has a fixed "Internal server error." message', () => {
    const err = new UnexpectedError({ some: 'junk' });
    expect(err.message).toBe('Internal server error.');
  });

  it('preserves the raw thrown value as .cause', () => {
    const raw = new Error('root');
    const err = new UnexpectedError(raw);
    expect(err.cause).toBe(raw);
  });

  it('accepts any thrown value (string, number, object) as cause', () => {
    expect(() => new UnexpectedError('a string')).not.toThrow();
    expect(() => new UnexpectedError(42)).not.toThrow();
    expect(() => new UnexpectedError({ x: 1 })).not.toThrow();
    expect(() => new UnexpectedError(null)).not.toThrow();
  });

  it('toApiResponse() returns 500 with an opaque { error } body (no code)', async () => {
    // Suppress the console.error so the test output stays clean; also
    // verify it fires with the raw cause.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const raw = new Error('secret leak');
      const err = new UnexpectedError(raw);
      const response = err.toApiResponse();

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({ error: 'Internal server error.' });
      // Body does NOT include the raw cause — that stays server-side.
      expect(body).not.toHaveProperty('cause');

      // Server-side log DOES include it (for debugging).
      expect(spy).toHaveBeenCalledWith(
        '[api] unexpected error:',
        raw,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('logs `this` when cause is nullish (falls back so log is not silent)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const err = new UnexpectedError(null);
      err.toApiResponse();
      // Second arg falls back to the error itself when cause is nullish.
      expect(spy).toHaveBeenCalledWith('[api] unexpected error:', err);
    } finally {
      spy.mockRestore();
    }
  });
});
