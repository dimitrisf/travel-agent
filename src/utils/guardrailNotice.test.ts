import { describe, it, expect } from 'vitest';
import type { AgentInputItem } from '@openai/agents';
import {
  GUARDRAIL_NOTICE_TYPE,
  isGuardrailNotice,
  stripGuardrailNoticesFromHistory,
} from './guardrailNotice';

// Unit tests for the guardrail_notice shape helpers. Small and pure —
// the "invariant enforcement" surface for Stage 22 backlog #2a.

describe('isGuardrailNotice', () => {
  it('recognizes an item with type === GUARDRAIL_NOTICE_TYPE', () => {
    expect(
      isGuardrailNotice({
        type: GUARDRAIL_NOTICE_TYPE,
        kind: 'output',
        message: 'x',
      }),
    ).toBe(true);
  });

  it('rejects SDK item shapes', () => {
    expect(isGuardrailNotice({ role: 'user', content: 'x' })).toBe(false);
    expect(
      isGuardrailNotice({
        role: 'assistant',
        content: [{ type: 'output_text', text: 'x' }],
      }),
    ).toBe(false);
    expect(
      isGuardrailNotice({
        type: 'function_call',
        callId: 'c1',
        name: 'x',
        arguments: '{}',
      }),
    ).toBe(false);
    expect(
      isGuardrailNotice({
        type: 'function_call_result',
        callId: 'c1',
        output: { type: 'text', text: '{}' },
      }),
    ).toBe(false);
  });

  it('rejects null / undefined / non-object inputs', () => {
    expect(isGuardrailNotice(null)).toBe(false);
    expect(isGuardrailNotice(undefined)).toBe(false);
    expect(isGuardrailNotice('a string')).toBe(false);
    expect(isGuardrailNotice(42)).toBe(false);
  });

  it('rejects an object without the discriminator', () => {
    expect(isGuardrailNotice({})).toBe(false);
    expect(isGuardrailNotice({ type: 'something_else' })).toBe(false);
  });
});

describe('stripGuardrailNoticesFromHistory', () => {
  it('returns the input unchanged when no guardrail_notice items are present', () => {
    const history = [
      { role: 'user', content: 'x' },
      { role: 'assistant', content: [{ type: 'output_text', text: 'y' }] },
    ] as unknown as AgentInputItem[];
    expect(stripGuardrailNoticesFromHistory(history)).toEqual(history);
  });

  it('drops only guardrail_notice items, preserving order of the rest', () => {
    const history = [
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
      // The item that must be stripped before this reaches run().
      { type: GUARDRAIL_NOTICE_TYPE, kind: 'output', message: 'blocked' },
      { role: 'user', content: 'next turn' },
    ] as unknown as AgentInputItem[];

    const filtered = stripGuardrailNoticesFromHistory(history);

    expect(filtered).toHaveLength(4);
    expect(
      filtered.some((item) => (item as { type?: string }).type === GUARDRAIL_NOTICE_TYPE),
    ).toBe(false);
    // Order preserved.
    expect((filtered[0] as { role?: string }).role).toBe('user');
    expect((filtered[1] as { type?: string }).type).toBe('function_call');
    expect((filtered[2] as { type?: string }).type).toBe('function_call_result');
    expect((filtered[3] as { role?: string }).role).toBe('user');
  });

  it('handles multiple guardrail_notice items in a row', () => {
    const history = [
      { role: 'user', content: 'x' },
      { type: GUARDRAIL_NOTICE_TYPE, kind: 'output', message: 'a' },
      { type: GUARDRAIL_NOTICE_TYPE, kind: 'input', message: 'b' },
      { role: 'user', content: 'y' },
    ] as unknown as AgentInputItem[];
    const filtered = stripGuardrailNoticesFromHistory(history);
    expect(filtered).toHaveLength(2);
    expect((filtered[0] as { content?: string }).content).toBe('x');
    expect((filtered[1] as { content?: string }).content).toBe('y');
  });

  it('returns an empty array unchanged', () => {
    expect(stripGuardrailNoticesFromHistory([])).toEqual([]);
  });
});
