// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SamplePrompts } from './SamplePrompts';
import { SAMPLE_PROMPTS } from '@/config/samplePrompts';

describe('SamplePrompts', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders one chip per SAMPLE_PROMPT', () => {
    render(<SamplePrompts onSelect={vi.fn()} disabled={false} />);
    for (const prompt of SAMPLE_PROMPTS) {
      expect(screen.getByText(prompt)).toBeInTheDocument();
    }
  });

  it('calls onSelect with the chip text when clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<SamplePrompts onSelect={onSelect} disabled={false} />);

    await user.click(screen.getByText(SAMPLE_PROMPTS[0]));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(SAMPLE_PROMPTS[0]);
  });

  it('propagates disabled state to the underlying chips', () => {
    render(<SamplePrompts onSelect={vi.fn()} disabled={true} />);

    // MUI Chip signals disabled via aria-disabled + a CSS class that
    // sets pointer-events:none. Asserting aria-disabled proves the
    // prop actually reaches the DOM. Real users then can't click,
    // and user-event refuses to click disabled elements — both are
    // exercised at the browser layer, not this unit test.
    const chip = screen
      .getByText(SAMPLE_PROMPTS[0])
      .closest('.MuiChip-root');
    expect(chip).toHaveAttribute('aria-disabled', 'true');
  });
});
