import { describe, it, expect } from 'vitest';
import type { AgentInputItem } from '@openai/agents';
import { hydrateChatMessages } from './hydrateChatMessages';

// Minimal regression test file for hydrateChatMessages. The full behavior
// (tool-call grouping, guardrail notices, MCP envelope unwrapping) is
// exercised indirectly via the /c/[id] page path; this file pins the
// specific defect fixed here.

describe('hydrateChatMessages — user-turn content shapes', () => {
  it('accepts the array-content shape ({role:"user", content:[{type:"input_text", text:"..."}]}) that newer @openai/agents versions emit', async () => {
    // Regression: isUserTurn used to require typeof content === 'string'.
    // A user turn produced by a newer SDK client would fail the predicate,
    // openBubblesForUserTurn would never run, currentAgent would stay null,
    // and every downstream tool_call / assistant / guardrail item that
    // belongs to that turn would be silently dropped by the
    // `if (!currentAgent) continue` guard in the main loop.
    const history: AgentInputItem[] = [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'plan a trip' },
          { type: 'input_image', image: 'https://example.com/x.png' },
          { type: 'input_text', text: 'starting in Berlin' },
        ],
      } as unknown as AgentInputItem,
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Sure — how many nights?' }],
      } as unknown as AgentInputItem,
    ];

    const bubbles = hydrateChatMessages(history);

    // Two bubbles: user turn opens both, assistant text lands in the second.
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0].role).toBe('user');
    // Text-parts concatenated; input_image skipped.
    expect(bubbles[0].text).toBe('plan a trip starting in Berlin');
    expect(bubbles[1].role).toBe('agent');
    // Confirms the assistant turn wasn't silently dropped by the null-agent
    // guard because the user turn was skipped — the original failure mode.
    expect(bubbles[1].text).toBe('Sure — how many nights?');
  });

  it('still handles the bare-string content shape (older SDK)', () => {
    const history: AgentInputItem[] = [
      { role: 'user', content: 'hi there' } as unknown as AgentInputItem,
    ];

    const bubbles = hydrateChatMessages(history);

    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].role).toBe('user');
    expect(bubbles[0].text).toBe('hi there');
  });
});
