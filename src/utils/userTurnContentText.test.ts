import { describe, it, expect } from 'vitest';
import { userTurnContentText } from './userTurnContentText';

describe('userTurnContentText', () => {
  it('returns a bare string verbatim (older SDK shape)', () => {
    expect(userTurnContentText('plan a trip to Berlin')).toBe(
      'plan a trip to Berlin',
    );
  });

  it('concatenates every part with a text field, skipping non-text parts', () => {
    // Mixed text + image + text — image is skipped, text parts joined
    // with a space so the result reads as one sentence rather than
    // "planatripstartinginBerlin".
    expect(
      userTurnContentText([
        { type: 'input_text', text: 'plan a trip' },
        { type: 'input_image', image: 'https://example.com/x.png' },
        { type: 'input_text', text: 'starting in Berlin' },
      ]),
    ).toBe('plan a trip starting in Berlin');
  });

  it('returns "" for shapes with no extractable text', () => {
    // Empty array.
    expect(userTurnContentText([])).toBe('');
    // Array with parts that have no `text: string` field.
    expect(
      userTurnContentText([
        { type: 'input_image', image: 'x' },
        { type: 'audio', src: 'y' },
      ]),
    ).toBe('');
    // Bare non-string, non-array values.
    expect(userTurnContentText(null)).toBe('');
    expect(userTurnContentText(undefined)).toBe('');
    expect(userTurnContentText(42)).toBe('');
  });
});
