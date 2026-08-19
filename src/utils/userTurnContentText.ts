// Extract the human-readable text from a user turn's `content` field.
// A user turn's content comes in two Agents SDK shapes:
//   - Bare string (older @openai/agents):
//       'plan a trip to Berlin'
//   - Array of typed content parts (newer @openai/agents and the
//     Responses API's native shape):
//       [{ type: 'input_text', text: 'plan a trip' },
//        { type: 'input_image', image: '...' },
//        { type: 'input_text', text: 'starting in Berlin' }]
//
// For the array shape, concatenate every part with a `text: string`
// field (skipping input_image and any other typed parts) so a
// multi-part message reads as one string with spaces between parts.
//
// Returns '' when the content is neither a string nor an array with any
// text parts. Callers decide what "empty" means for them (drop the
// turn, use as fallback, treat as "no title", etc.).
//
// Historical note: this helper exists because three call sites in the
// codebase used to do their own shape check, and the older shape check
// silently skipped array-content turns — hydrated /c/[id] pages
// dropped entire turns, and the header dropdown showed "Untitled
// conversation" for perfectly good first user messages produced by a
// newer-SDK client.
export function userTurnContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (p): p is { text: string } =>
        p !== null &&
        typeof p === 'object' &&
        typeof (p as { text?: unknown }).text === 'string',
    )
    .map((p) => p.text)
    .join(' ');
}
