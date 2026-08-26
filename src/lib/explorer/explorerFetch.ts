import type { ExplorerError, HttpMethod, ResponseState } from './explorerTypes';

// Wraps fetch with timing measurement + typed error parsing. Every endpoint
// page uses this so response handling (status, timing, error shape) stays
// uniform across the explorer. Never throws — always resolves to a
// ResponseState.
export async function explorerFetch<T>(opts: {
  method: HttpMethod;
  path: string;
  body?: unknown;
}): Promise<ResponseState<T>> {
  const started = performance.now();
  try {
    const init: RequestInit = { method: opts.method };
    if (opts.method === 'POST') {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(opts.body ?? {});
    }
    const res = await fetch(opts.path, init);
    const timing = Math.round(performance.now() - started);
    const status = res.status;

    // Parse body regardless of status — apiErrorResponse returns JSON on
    // both success and error paths.
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      /* leave parsed as null */
    }

    if (res.ok) {
      return { kind: 'success', status, timing, data: parsed as T };
    }

    return {
      kind: 'error',
      status,
      timing,
      error: extractError(parsed, status),
    };
  } catch (err) {
    const timing = Math.round(performance.now() - started);
    return {
      kind: 'error',
      status: 0,
      timing,
      error: {
        message: err instanceof Error ? err.message : 'Network error',
      },
    };
  }
}

// Best-effort extraction of the typed error shape { error: { code, message } }
// or the older { error: string } — falls back to a generic HTTP status message.
function extractError(parsed: unknown, status: number): ExplorerError {
  if (parsed && typeof parsed === 'object') {
    const p = parsed as { error?: unknown };

    if (p.error && typeof p.error === 'object') {
      const e = p.error as { code?: unknown; message?: unknown };

      return {
        code: typeof e.code === 'string' ? e.code : undefined,
        message: typeof e.message === 'string' ? e.message : `HTTP ${status}`,
      };
    }

    if (typeof p.error === 'string') {
      return { message: p.error };
    }
  }

  return { message: `HTTP ${status}` };
}
