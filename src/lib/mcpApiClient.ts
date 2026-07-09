// Small helper factory shared by the MCP servers (weather-mcp, travel-mcp).
// Given a base URL, returns a `callApi(path, args)` that:
//   - builds a URL from base + path
//   - encodes each arg key as a query-string parameter (skipping undefined /
//     null; joining arrays with commas)
//   - fetches the backing REST API
//   - wraps the response in the MCP tool-result shape
// The returned object is exactly what an MCP tool handler must return:
//   { content: [{ type: 'text', text }], isError: boolean }

export function createMcpApiClient(base: string) {
  return {
    // Given a path and an args object, build a URL with each arg as a query
    // parameter (via setParam), then fetch the backing REST API and wrap the
    // result in the MCP content shape. All args key names must match the REST
    // query-string keys 1:1 — which they do, by design of the input schemas.
    // The returned value has the shape { content: [{ type: 'text', text: string }], isError: boolean } and is needed by the MCP server to handle tool results correctly.
    async callApi(path: string, args: Record<string, unknown>) {
      const url = new URL(path, base);
      for (const [key, value] of Object.entries(args)) {
        setParam(url, key, value);
      }
      return fetchAsToolResult(url);
    },
  };
}

// Helper to set a query parameter on a URL, skipping undefined or null values. Arrays are joined with commas.
// e.g. setParam(url, 'preferred_airlines', ['A3', 'LH']) → ?preferred_airlines=A3,LH
// e.g. setParam(url, 'max_price', undefined) → (no query parameter added)
// e.g. setParam(url, 'cabin_class', 'economy') → ?cabin_class=economy
// e.g. setParam(url, 'nonstop_only', true) → ?nonstop_only=true
// e.g. setParam(url, 'nonstop_only', false) → ?nonstop_only=false
// e.g. setParam(url, 'return_date', null) → (no query parameter added)
// e.g. setParam(url, 'return_date', '2024-07-01') → ?return_date=2024-07-01
// e.g. setParam(url, 'preferred_airlines', []) → ?preferred_airlines= (empty string)
function setParam(url: URL, key: string, value: unknown): void {
  if (value === undefined || value === null) return;
  url.searchParams.set(
    key,
    Array.isArray(value) ? value.join(',') : String(value),
  );
}

// Helper to fetch a URL and return the result in the format expected by the MCP server. Returns an object with `content` (array of text blocks) and `isError` (boolean indicating if the response was not OK).
async function fetchAsToolResult(url: URL) {
  const r = await fetch(url);
  const text = await r.text();
  return {
    content: [{ type: 'text' as const, text }],
    isError: !r.ok,
  };
}
