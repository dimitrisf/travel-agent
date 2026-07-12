// The SDK passes guardrail input as `string | ModelItem[]`. In our route
// handler we always pass an array (history + new user turn), so we walk
// backward to the latest user message and pull its text content.
//
// `ModelItemLike` is a permissive walker's-eye view of the SDK's ModelItem —
// kept private on purpose. Consumers should not depend on this shape; if a
// caller needs a different projection, define a local type there.
type ModelItemLike = {
  role?: string;
  content?: unknown;
};

// Walks backward through the input array to find the latest user message and
// extract its text content. Returns null if no user message is found or if the
// content is empty.
// The input can be a string (single user message) or an array of ModelItemLike objects (conversation history). If the input is a string, it is returned as-is. If the input is an array, the function looks for the last item with role 'user' and extracts its text content, handling both string and array content types.
// The value of the input parameter comes from the Agents SDK's `input` property, which is passed to the guardrail's `execute` method. The input can be a string (single user message) or an array of ModelItemLike objects (conversation history). If the input is a string, it is returned as-is. If the input is an array, the function looks for the last item with role 'user' and extracts its text content, handling both string and array content types.
// For example, input could be a string like "Hello" or an array like [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi there!' }]
export function extractLatestUserText(
  input: string | unknown[],
): string | null {
  if (typeof input === 'string') return input.trim() || null;
  if (!Array.isArray(input)) return null;

  for (let i = input.length - 1; i >= 0; i--) {
    const item = input[i] as ModelItemLike;
    if (!item || item.role !== 'user') continue;

    const content = item.content;
    if (typeof content === 'string') return content.trim() || null;

    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (
            part &&
            typeof part === 'object' &&
            'text' in part &&
            typeof (part as { text: unknown }).text === 'string'
          ) {
            // E.g., part could be { text: "Hello" } or { text: "Hello", annotations: [...] }
            return (part as { text: string }).text;
          }
          return '';
        })
        .join('');
      return text.trim() || null;
      // For example, if the input is:
      // [{ role: 'user', 
      //    content: [{ text: 'Hello' },
      //              { text: ' World' }] 
      //  },
      //  { role: 'assistant',
      //    content: 'Hi there!' }]
      // ]
      // , this will return 'Hello World'. 
    }
  }
  return null;
}
