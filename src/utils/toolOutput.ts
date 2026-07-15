// We define a helper function that unwraps the output of a tool call into a string. The output can be a string, an object with a text property, or an object with a content array. We handle each case and return a string representation of the output. This allows us to send the tool output to the client in a consistent format.
export function unwrapToolOutput(output: unknown): string {
  // E.g, output = "Athens" (a string) or { text: "Athens" } (an object with a text property) or { content: [{ text: "Athens" }] } (an object with a content array).

  if (typeof output === 'string') return output;

  if (output && typeof output === 'object') {
    const asObj = output as { text?: unknown; content?: unknown };

    if (typeof asObj.text === 'string') return asObj.text;

    if (Array.isArray(asObj.content) && asObj.content.length > 0) {
      // E.g, asObj.content = [{ text: "Athens" }] (an array of objects with a text property).
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
    // E.g, output = { temperature: 25, condition: "sunny" } (an object with arbitrary properties). We stringify it to send to the client.
    return JSON.stringify(output);
  }

  // E.g, output = 25 (a number) or true (a boolean) or null or undefined. We convert it to a string to send to the client.
  return String(output ?? '');
}
