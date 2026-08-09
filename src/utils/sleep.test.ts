import { describe, it, expect, vi } from 'vitest';
import { sleep } from './sleep';

describe('sleep', () => {
  it('resolves after approximately the requested delay', async () => {
    // Use fake timers so the test doesn't actually wait 100ms of wall-
    // clock time on every run. sleep is a Promise wrapper around
    // setTimeout — advancing fake timers by the requested ms should
    // resolve the promise.
    vi.useFakeTimers();
    try {
      let resolved = false;
      const p = sleep(100).then(() => {
        resolved = true;
      });

      expect(resolved).toBe(false);

      // Advance time; the microtask queue needs a tick after
      // runAllTimers for the .then callback to fire.
      await vi.advanceTimersByTimeAsync(100);
      await p;

      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves to undefined', async () => {
    vi.useFakeTimers();
    try {
      const p = sleep(0);
      await vi.advanceTimersByTimeAsync(0);
      await expect(p).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
