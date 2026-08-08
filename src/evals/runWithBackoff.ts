// Retry-with-backoff wrapper for the eval harness (Stage 17.6).
//
// Motivation: the full suite regularly tripped 429 "TPM rate limit" errors
// on cancel-proposed-booking-happy-path — a 4-turn case whose tokens land
// deep in the rolling 60s window after earlier real-agent cases have
// already eaten most of the 30k gpt-4o budget. Without retry, one 429 in
// the middle of any turn failed the whole case even though OpenAI was
// explicitly telling us "try again in Xs" in the error body.
//
// Behavior:
//   - Only retries 429s (identified by the error message). Other errors
//     re-throw unchanged so real failures are still surfaced.
//   - Parses the wait time from the OpenAI error message. Two formats
//     seen in the wild: "Please try again in 692ms" and "Please try
//     again in 10.458s". Adds a small buffer on top (250ms / 500ms)
//     so we don't retry right at the boundary and race the window.
//   - Falls back to exponential backoff with jitter (2s / 4s / 8s + up
//     to 500ms jitter) if the message shape changes and the parse fails.
//   - Bounded — maxRetries defaults to 3, so a truly stuck endpoint
//     doesn't hang the suite indefinitely.
//   - onRetry callback lets the caller print a visibility line to the
//     eval log ("waiting Xms before retry N"). Skipped in brief mode
//     would be a call-site decision; the helper stays quiet by default.
//
// Portability note: this is a general 429-handling shape. Same pattern
// works for any external API that returns Retry-After style hints —
// swap the error detector + parser and the rest of the flow is unchanged.

import { sleep } from '@/utils/sleep';

export type BackoffResult<T> = {
  value: T;
  retries: number;
};

export type BackoffOptions = {
  maxRetries?: number;
  onRetry?: (attempt: number, waitMs: number) => void;
};

export async function runWithBackoff<T>(
  fn: () => Promise<T>,
  opts: BackoffOptions = {},
): Promise<BackoffResult<T>> {
  const maxRetries = opts.maxRetries ?? 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const value = await fn();
      return { value, retries: attempt };
    } catch (err) {
      const isLast = attempt === maxRetries;

      // Only retry 429s. Other errors are real failures and should be
      // surfaced to the caller. If this is the last attempt, re-throw
      // so the caller sees the failure.
      if (!isRateLimit(err) || isLast) throw err;

      // Parse the wait time from the OpenAI error message. If the shape
      // changes and the parse fails, fall back to exponential backoff
      // with jitter.
      const waitMs = parseRetryDelayMs(err) ?? fallbackBackoffMs(attempt);

      // Let the caller log a visibility line if they want. In brief mode
      // this is skipped, but the caller can choose to log it in full mode.
      opts.onRetry?.(attempt + 1, waitMs);

      await sleep(waitMs);
    }
  }

  // Unreachable — the loop either returns on success or throws on the
  // final attempt. TypeScript doesn't infer that from the loop shape.
  throw new Error('runWithBackoff: unreachable');
}

function isRateLimit(err: unknown): boolean {
  const msg = (err as Error)?.message ?? '';
  // OpenAI 429s always contain "429" AND "Rate limit" — both checks so
  // an unrelated error message that happens to say "rate limit" (e.g.
  // "cannot rate limit this endpoint") doesn't trigger a wrong retry.
  return msg.includes('429') && /rate limit/i.test(msg);
}

// Parse "Please try again in Xms" or "Please try again in Xs" out of
// the OpenAI error message. Returns null if the shape doesn't match
// (message format changed, upstream error, etc.) so the caller falls
// back to exponential backoff.
function parseRetryDelayMs(err: unknown): number | null {
  const msg = (err as Error)?.message ?? '';

  const msMatch = msg.match(/try again in (\d+(?:\.\d+)?)ms/i);
  if (msMatch) {
    // Add 250ms buffer so we don't hit the boundary and race the window.
    return Math.ceil(parseFloat(msMatch[1])) + 250;
  }

  const sMatch = msg.match(/try again in (\d+(?:\.\d+)?)s/i);
  if (sMatch) {
    return Math.ceil(parseFloat(sMatch[1]) * 1000) + 500;
  }

  return null;
}

// Exponential backoff with jitter: 2s, 4s, 8s + up to 500ms of jitter.
// Jitter prevents multiple parallel callers (if we ever grow to run
// cases concurrently) from all retrying at exactly the same tick.
function fallbackBackoffMs(attempt: number): number {
  const base = Math.pow(2, attempt + 1) * 1000;
  const jitter = Math.random() * 500;
  return base + jitter;
}

