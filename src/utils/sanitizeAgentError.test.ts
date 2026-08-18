import { describe, it, expect } from 'vitest';
import {
  AGENT_ERROR_MESSAGE,
  sanitizeAgentError,
} from './sanitizeAgentError';

describe('sanitizeAgentError', () => {
  it('returns the fixed AGENT_ERROR_MESSAGE constant', () => {
    expect(sanitizeAgentError()).toBe(AGENT_ERROR_MESSAGE);
  });

  it('never leaks tokens that resemble API keys, status codes, or provider names', () => {
    const msg = sanitizeAgentError();
    // These substrings would indicate a raw provider/SDK error string
    // leaked through. Explicit list rather than `expect.not.stringMatching`
    // so the intent is legible in the assertion output on regression.
    expect(msg).not.toMatch(/sk-/i);
    expect(msg).not.toMatch(/\b401\b/);
    expect(msg).not.toMatch(/\b429\b/);
    expect(msg).not.toMatch(/\b500\b/);
    expect(msg).not.toMatch(/openai/i);
    expect(msg).not.toMatch(/anthropic/i);
    expect(msg).not.toMatch(/api key/i);
  });

  it('reads as a user-friendly, actionable sentence', () => {
    const msg = sanitizeAgentError();
    // Loose sanity checks — the exact wording can change, these
    // guard against accidental regressions into terse/internal tone.
    expect(msg.length).toBeGreaterThan(20);
    expect(msg).toMatch(/try again/i);
  });
});
