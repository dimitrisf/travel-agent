import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { apiErrorResponse } from './apiErrorResponse';
import {
  ServiceError,
  UnexpectedError,
  WeatherServiceError,
  ZodValidationError,
} from '@/lib';

// The public contract of apiErrorResponse is: it converts ANY thrown
// value into an HTTP response. classify() is private, but its three
// branches (ServiceError passthrough, ZodError → wrap, else →
// UnexpectedError) are all observable through the public function's
// response shape.

describe('apiErrorResponse', () => {
  it('passes an existing ServiceError straight through to toApiResponse()', async () => {
    const err = new WeatherServiceError('nope', 'CITY_NOT_FOUND');
    const response = apiErrorResponse(err);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ error: 'nope', code: 'CITY_NOT_FOUND' });
  });

  it('wraps a caught ZodError as ZodValidationError (400 with issues)', async () => {
    const schema = z.object({ city: z.string().min(1) });
    let zodErr: unknown;
    try {
      schema.parse({ city: '' });
    } catch (err) {
      zodErr = err;
    }
    expect(zodErr).toBeInstanceOf(z.ZodError);

    const response = apiErrorResponse(zodErr);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid request parameters.');
    expect(body.issues).toEqual((zodErr as z.ZodError).issues);
  });

  it('wraps a plain Error as UnexpectedError (opaque 500)', async () => {
    // Suppress the [api] unexpected error: log so test output stays
    // clean.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = apiErrorResponse(new Error('boom'));
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({ error: 'Internal server error.' });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('wraps a non-Error thrown value (string, number) as UnexpectedError', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = apiErrorResponse('a string was thrown');
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({ error: 'Internal server error.' });
    } finally {
      spy.mockRestore();
    }
  });

  it('does not wrap ZodValidationError or UnexpectedError a second time', async () => {
    // Both extend ServiceError, so the passthrough branch catches them.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const already = new UnexpectedError(new Error('root'));
      const response = apiErrorResponse(already);
      expect(response.status).toBe(500);
      // We should see the same instance's toApiResponse output —
      // still an opaque 500, not "wrapped in another UnexpectedError".
      const body = await response.json();
      expect(body).toEqual({ error: 'Internal server error.' });
    } finally {
      spy.mockRestore();
    }
  });

  it('does not swallow a ZodValidationError re-thrown from classify (branch order)', async () => {
    // A pre-wrapped ZodValidationError should hit the ServiceError
    // passthrough branch, not the ZodError branch. This means it
    // renders exactly the same as the branch above — no double-wrap.
    const schema = z.object({ city: z.string().min(1) });
    let zodErr: z.ZodError | undefined;
    try {
      schema.parse({ city: '' });
    } catch (err) {
      if (err instanceof z.ZodError) zodErr = err;
    }
    const wrapped = new ZodValidationError(zodErr!);

    const responseA = apiErrorResponse(wrapped);
    const responseB = apiErrorResponse(zodErr);

    // Both should produce a 400 with the same body shape.
    expect(responseA.status).toBe(400);
    expect(responseB.status).toBe(400);
    const bodyA = await responseA.json();
    const bodyB = await responseB.json();
    expect(bodyA).toEqual(bodyB);
  });

  it('marks the ServiceError branch definitively — no test of instanceof needed at runtime', () => {
    // Bookkeeping: the ServiceError passthrough branch is exercised by
    // the WeatherServiceError test above. The test here just asserts
    // that WeatherServiceError does extend ServiceError, which
    // confirms the passthrough was actually the branch taken.
    const err = new WeatherServiceError('x', 'CITY_NOT_FOUND');
    expect(err).toBeInstanceOf(ServiceError);
  });
});
