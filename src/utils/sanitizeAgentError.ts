// Generic user-facing message for any non-guardrail agent-side error.
// Named + exported so tests can assert on it (see sanitizeAgentError.test.ts).
export const AGENT_ERROR_MESSAGE =
  'Sorry, something went wrong on our end. Please try again in a moment.';

// Discovered during Stage 23 E1 (corrupted OPENAI_API_KEY): the app
// used to surface the raw thrown error's `.message` to the client, so
// a 401 turned into a chat bubble reading
//   "Error: 401 Incorrect API key provided: --sk-pro***********vPIA..."
// with an OpenAI URL — internal state and a (partially masked) API
// key fragment leaked into the user-visible UI. Callers already log
// the raw error server-side; this helper is what goes to the client.
//
// Deliberately doesn't inspect `err` and doesn't return anything
// derived from it: any inspection is surface area where we can
// accidentally leak. One safe message covers rate limits, timeouts,
// network errors, SDK bugs, and everything else.
export function sanitizeAgentError(): string {
  return AGENT_ERROR_MESSAGE;
}
