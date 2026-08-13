import { describe, it, expect } from 'vitest';
import type { AgentInputItem } from '@openai/agents';
import { buildGuardrailBlockedItems } from './buildGuardrailBlockedItems';
import { GUARDRAIL_NOTICE_TYPE } from './guardrailNotice';

// Unit tests for the guardrail-blocked persistence builder. Exercises
// the pure item-construction logic that used to live inline in the
// agent route's catch block.

describe('buildGuardrailBlockedItems', () => {
  it('always emits the user message first and the guardrail_notice last', () => {
    const items = buildGuardrailBlockedItems({
      userInput: 'Book that hotel',
      streamHistory: [],
      priorHistoryLength: 0,
      message: "I can't help with that.",
      kind: 'output',
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ role: 'user', content: 'Book that hotel' });
    expect(items[1]).toEqual({
      type: GUARDRAIL_NOTICE_TYPE,
      kind: 'output',
      message: "I can't help with that.",
    });
  });

  it('emits kind: "input" for input-guardrail case (no tool items)', () => {
    // Input guardrails trip before any tool runs — stream.history is
    // just the initial user message we passed to run().
    const streamHistory = [
      { role: 'user', content: 'blocked prompt' },
    ] as unknown as AgentInputItem[];
    const items = buildGuardrailBlockedItems({
      userInput: 'blocked prompt',
      streamHistory,
      priorHistoryLength: 0,
      message: 'blocked',
      kind: 'input',
    });
    expect(items).toHaveLength(2);
    expect(items[1]).toEqual({
      type: GUARDRAIL_NOTICE_TYPE,
      kind: 'input',
      message: 'blocked',
    });
  });

  it('includes function_call and function_call_result items in order', () => {
    const streamHistory = [
      { role: 'user', content: 'x' },
      {
        type: 'function_call',
        callId: 'c1',
        name: 'search_hotels',
        arguments: '{}',
      },
      {
        type: 'function_call_result',
        callId: 'c1',
        output: { type: 'text', text: '[]' },
      },
    ] as unknown as AgentInputItem[];

    const items = buildGuardrailBlockedItems({
      userInput: 'x',
      streamHistory,
      priorHistoryLength: 0,
      message: 'blocked',
      kind: 'output',
    });
    // user + 2 tool items + notice = 4
    expect(items).toHaveLength(4);
    expect((items[1] as { type?: string }).type).toBe('function_call');
    expect((items[2] as { type?: string }).type).toBe('function_call_result');
    expect((items[3] as { type?: string }).type).toBe(GUARDRAIL_NOTICE_TYPE);
  });

  it("drops the offending assistant text — refresh must match what the user actually saw", () => {
    const streamHistory = [
      { role: 'user', content: 'x' },
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: 'BAD_OFFENDING_TEXT' }],
      },
    ] as unknown as AgentInputItem[];

    const items = buildGuardrailBlockedItems({
      userInput: 'x',
      streamHistory,
      priorHistoryLength: 0,
      message: 'blocked',
      kind: 'output',
    });

    // Flatten all text-bearing fields across the persisted items so we
    // can assert the offending text is nowhere.
    const persistedTexts = items.flatMap((it) => {
      const rec = it as { content?: unknown; message?: unknown };
      if (typeof rec.message === 'string') return [rec.message];
      if (Array.isArray(rec.content)) {
        return (rec.content as Array<{ text?: string }>)
          .map((c) => c.text)
          .filter((t): t is string => typeof t === 'string');
      }
      return typeof rec.content === 'string' ? [rec.content] : [];
    });

    expect(persistedTexts).not.toContain('BAD_OFFENDING_TEXT');
    // The friendly notice text IS persisted (via the guardrail_notice item).
    expect(persistedTexts).toContain('blocked');
    // The user's own message survives.
    expect(persistedTexts).toContain('x');
  });

  it('slices from priorHistoryLength — ignores pre-turn history', () => {
    const streamHistory = [
      // Prior-turn items (should NOT be persisted again).
      { role: 'user', content: 'old-turn-1' },
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: 'old-response' }],
      },
      // Current turn.
      { role: 'user', content: 'current-turn' },
      {
        type: 'function_call',
        callId: 'c1',
        name: 'x',
        arguments: '{}',
      },
      {
        type: 'function_call_result',
        callId: 'c1',
        output: { type: 'text', text: '{}' },
      },
    ] as unknown as AgentInputItem[];

    const items = buildGuardrailBlockedItems({
      userInput: 'current-turn',
      streamHistory,
      priorHistoryLength: 2, // skip the two old-turn items
      message: 'blocked',
      kind: 'output',
    });

    // user + 2 tool items + notice = 4 (old-turn items excluded)
    expect(items).toHaveLength(4);
    expect((items[1] as { type?: string }).type).toBe('function_call');
    expect((items[2] as { type?: string }).type).toBe('function_call_result');
    expect((items[3] as { type?: string }).type).toBe(GUARDRAIL_NOTICE_TYPE);
  });
});
