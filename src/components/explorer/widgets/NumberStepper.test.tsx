// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { NumberStepper } from './NumberStepper';

describe('NumberStepper', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the label and the current value', () => {
    render(<NumberStepper label="Adults" value={2} onChange={vi.fn()} />);
    // The caption text plus an accessible textbox seeded to the value.
    expect(screen.getByText('Adults')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Adults' })).toHaveValue('2');
  });

  it('increments via the + button', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <NumberStepper label="Adults" value={2} onChange={onChange} min={1} max={9} />,
    );

    await user.click(screen.getByRole('button', { name: 'increment Adults' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('decrements via the − button', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <NumberStepper label="Adults" value={2} onChange={onChange} min={1} max={9} />,
    );

    await user.click(screen.getByRole('button', { name: 'decrement Adults' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('disables the − button at min and the + button at max', () => {
    const { unmount } = render(
      <NumberStepper label="Adults" value={1} onChange={vi.fn()} min={1} max={9} />,
    );
    expect(screen.getByRole('button', { name: 'decrement Adults' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'increment Adults' })).not.toBeDisabled();
    unmount();

    render(
      <NumberStepper label="Adults" value={9} onChange={vi.fn()} min={1} max={9} />,
    );
    expect(screen.getByRole('button', { name: 'decrement Adults' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'increment Adults' })).toBeDisabled();
  });

  it('clamps direct input to [min, max]', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <NumberStepper label="Adults" value={2} onChange={onChange} min={1} max={9} />,
    );

    const input = screen.getByRole('textbox', { name: 'Adults' });
    await user.clear(input);
    await user.type(input, '50');

    // Last emitted value is the clamped max (typing "5" then "0" —
    // "5" fits, "50" clamps to 9).
    expect(onChange).toHaveBeenLastCalledWith(9);
  });

  it('disables everything when disabled', () => {
    render(
      <NumberStepper
        label="Adults"
        value={2}
        onChange={vi.fn()}
        min={1}
        max={9}
        disabled
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Adults' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'increment Adults' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'decrement Adults' })).toBeDisabled();
  });
});
