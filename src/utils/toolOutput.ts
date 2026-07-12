// We define a helper function that unwraps the output of a tool call into a string. The output can be a string, an object with a text property, or an object with a content array. We handle each case and return a string representation of the output. This allows us to send the tool output to the client in a consistent format.
export function unwrapToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object') {
    const asObj = output as { text?: unknown; content?: unknown };
    if (typeof asObj.text === 'string') return asObj.text;
    if (Array.isArray(asObj.content) && asObj.content.length > 0) {
      return asObj.content
        .map((c) => {
          if (
            c &&
            typeof c === 'object' &&
            'text' in c &&
            typeof (c as { text: unknown }).text === 'string'
          ) {
            return (c as { text: string }).text;
          }
          return JSON.stringify(c);
        })
        .join('\n');
    }
    return JSON.stringify(output);
  }
  return String(output ?? '');
}
