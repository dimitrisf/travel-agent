import type { HttpMethod } from './explorerTypes';

// Renders the equivalent curl command for a given request. The base URL is
// derived from window.location so the command targets whichever deploy the
// user is currently on (localhost, preview, or prod).
export function buildCurl(opts: {
  method: HttpMethod;
  path: string;
  body?: unknown;
}): string {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  const url = `${base}${opts.path}`;

  if (opts.method === 'GET') {
    return `curl "${url}"`;
  }

  const bodyStr = JSON.stringify(opts.body ?? {}, null, 2);
  // Single-quoted POSIX shell strings can't contain single quotes;
  // close-escape-reopen for any that appear. Rare in JSON but cheap to handle.
  const escaped = bodyStr.replace(/'/g, `'\\''`);
  return `curl -X POST "${url}" \\
  -H "Content-Type: application/json" \\
  -d '${escaped}'`;
}
