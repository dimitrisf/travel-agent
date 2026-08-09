import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ZodValidationError } from './ZodValidationError';
import { ServiceError } from './ServiceError';

describe('ZodValidationError', () => {
  // Small helper — parse a known-bad input against a schema and return
  // the resulting ZodError (guaranteed to throw).
  function makeZodError(): z.ZodError {
    const schema = z.object({ city: z.string().min(1) });
    try {
      schema.parse({ city: '' });
      throw new Error('expected parse to throw');
    } catch (err) {
      if (err instanceof z.ZodError) return err;
      throw err;
    }
  }

  it('is an instance of ServiceError (so classify() recognizes it)', () => {
    const err = new ZodValidationError(makeZodError());
    expect(err).toBeInstanceOf(ServiceError);
    expect(err.name).toBe('ZodValidationError');
  });

  it('has a fixed "Invalid request parameters." message', () => {
    const err = new ZodValidationError(makeZodError());
    expect(err.message).toBe('Invalid request parameters.');
  });

  it('preserves the wrapped ZodError as .cause and .zodError', () => {
    const zodErr = makeZodError();
    const err = new ZodValidationError(zodErr);
    expect(err.cause).toBe(zodErr);
    expect(err.zodError).toBe(zodErr);
  });

  it('toApiResponse() returns 400 with { error, issues } body', async () => {
    const zodErr = makeZodError();
    const err = new ZodValidationError(zodErr);
    const response = err.toApiResponse();

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({
      error: 'Invalid request parameters.',
      issues: zodErr.issues,
    });
  });
});
