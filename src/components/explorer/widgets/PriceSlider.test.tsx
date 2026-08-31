// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PriceSlider } from './PriceSlider';

describe('PriceSlider', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders in "no cap" mode when value is undefined', () => {
    render(
      <PriceSlider label="Max price" value={undefined} onChange={vi.fn()} />,
    );
    expect(screen.getByText('Max price')).toBeInTheDocument();
    expect(screen.getByText('no cap')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByRole('slider')).toBeDisabled();
  });

  it('emits the defaultValue when the switch is toggled on', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <PriceSlider
        label="Max price"
        value={undefined}
        onChange={onChange}
        defaultValue={500}
      />,
    );

    await user.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(500);
  });

  it('emits undefined when the switch is toggled off', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<PriceSlider label="Max price" value={500} onChange={onChange} />);

    await user.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('renders the current value with € prefix when enabled', () => {
    render(<PriceSlider label="Max price" value={750} onChange={vi.fn()} />);
    // "€750" appears in both the switch label caption AND the slider's
    // value-label — asserting at least one is present is enough.
    expect(screen.getAllByText('€750').length).toBeGreaterThan(0);
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('slider')).not.toBeDisabled();
  });

  it('emits new numeric values as the slider changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <PriceSlider
        label="Max price"
        value={500}
        onChange={onChange}
        step={50}
      />,
    );

    // MUI Slider is keyboard-operable — ArrowRight steps forward by
    // `step`, which is cleaner to simulate than a drag gesture.
    const slider = screen.getByRole('slider');
    slider.focus();
    await user.keyboard('{ArrowRight}');

    expect(onChange).toHaveBeenLastCalledWith(550);
  });
});
