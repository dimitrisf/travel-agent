import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runWithBackoff } from './runWithBackoff';

// Shape mimics an OpenAI SDK error — the runWithBackoff detector looks
// for "429" AND "Rate limit" in the message. Helper keeps test bodies
// readable.
function makeRateLimitError(message: string): Error {
  const err = new Error(message);
  err.name = 'RateLimitError';
  return err;
}

describe('runWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the value on first-attempt success with retries=0', async () => {
    // The fn is called once, returns a value, and runWithBackoff returns
    // that value with retries=0. No timers are advanced because the
    // function succeeds immediately.
    const fn = vi.fn(async () => 'ok');
    const result = await runWithBackoff(fn);
    expect(result).toEqual({ value: 'ok', retries: 0 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('re-throws non-429 errors immediately without retry', async () => {
    const fn = vi.fn(async () => {
      throw new Error('some other failure');
    });
    await expect(runWithBackoff(fn)).rejects.toThrow('some other failure');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('parses "try again in Xms" and retries with 250ms buffer', async () => {
    let calls = 0;

    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        throw makeRateLimitError(
          '429 Rate limit reached. Please try again in 500ms.',
        );
      }
      return 'ok';
    });

    const promise = runWithBackoff(fn);
    // First attempt fires synchronously. Second attempt is scheduled
    // for 500 + 250 = 750ms out.
    await vi.advanceTimersByTimeAsync(750);
    const result = await promise;

    expect(result).toEqual({ value: 'ok', retries: 1 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('parses "try again in Xs" and retries with 500ms buffer', async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        throw makeRateLimitError(
          '429 Rate limit reached. Please try again in 1.5s.',
        );
      }
      return 'ok';
    });

    const promise = runWithBackoff(fn);
    // 1500 + 500 = 2000ms
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toEqual({ value: 'ok', retries: 1 });
  });

  it('falls back to exponential backoff (2s + jitter) when the message is not parseable', async () => {
    // Mock Math.random so jitter is deterministic (0.5 → 250ms jitter).
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        // 429 + "Rate limit" present, but no "try again in ..." shape.
        throw makeRateLimitError('429 Rate limit hit — unusual format.');
      }
      return 'ok';
    });

    const promise = runWithBackoff(fn);
    // First-attempt fallback = 2^(0+1) * 1000 + 0.5 * 500 = 2000 + 250 = 2250ms
    await vi.advanceTimersByTimeAsync(2250);
    const result = await promise;

    expect(result).toEqual({ value: 'ok', retries: 1 });
  });

  it('gives up after maxRetries and re-throws the last error', async () => {
    const fn = vi.fn(async () => {
      throw makeRateLimitError(
        '429 Rate limit reached. Please try again in 10ms.',
      );
    });

    const promise = runWithBackoff(fn, { maxRetries: 2 });
    // Attach a catch synchronously so the eventual rejection doesn't
    // surface as an unhandled rejection while we advance timers.
    const settled = promise.catch((e) => e as Error);

    // Two waits: 260ms after attempt 1, 260ms after attempt 2.
    // Advance generously — timers only fire on scheduled boundaries.
    await vi.advanceTimersByTimeAsync(1000);
    const err = await settled;

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/429/);
    // Attempts: 0 (initial), 1 (first retry), 2 (second retry / last).
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('calls onRetry with the wait time before each retry', async () => {
    const onRetry = vi.fn();

    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls === 1) {
        throw makeRateLimitError(
          '429 Rate limit reached. Please try again in 100ms.',
        );
      }
      return 'ok';
    });

    const promise = runWithBackoff(fn, { onRetry });
    await vi.advanceTimersByTimeAsync(400);
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(1);
    // First retry is attempt=1, waitMs=100+250=350
    expect(onRetry).toHaveBeenCalledWith(1, 350);
  });

  it('does not retry a message that says "rate limit" but lacks 429', async () => {
    // Both signals required — prevents false positives like
    // "cannot rate limit this endpoint".
    const fn = vi.fn(async () => {
      throw new Error('cannot rate limit this endpoint');
    });

    await expect(runWithBackoff(fn)).rejects.toThrow(
      'cannot rate limit this endpoint',
    );

    expect(fn).toHaveBeenCalledTimes(1);
  });
});
