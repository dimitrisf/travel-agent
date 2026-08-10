// Base URL for loopback calls between MCP endpoints and the API routes
// they wrap (both live in the same Next.js process). Explicit env-var
// overrides (`WEATHER_API_BASE`, `TRAVEL_API_BASE`, `APP_BASE`,
// `TRAVEL_MCP_URL`, `WEATHER_MCP_URL`) still win — those are for
// splitting MCPs into separate services later. This helper is the
// default when no override is set.
//
// Deploy layers, in order of precedence:
//   - Vercel (any env: prod / preview / dev): use VERCEL_URL, which
//     Vercel populates with the current deployment's hostname (no
//     protocol). Per-deployment URL means preview deploys reach
//     themselves, not the prod deploy.
//   - Local dev: fall back to http://localhost:${PORT ?? 3000}.
//
// Note: VERCEL_URL is the per-deployment URL — deliberately not
// VERCEL_PROJECT_PRODUCTION_URL. Each deploy is self-contained; loopback
// should hit the same deploy that received the request.
export function getDefaultAppBase(): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
