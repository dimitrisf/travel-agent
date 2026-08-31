// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import { StarsSelect } from './StarsSelect';

// MUI Rating renders each star as a visually-hidden radio input with a
// numeric `value` attribute ("1"…"5"), and an "Empty" radio with
// value="". user-event has trouble clicking the visually-hidden radios
// reliably; fireEvent.click on the input by value attribute
// short-circuits the delivery and lets MUI's internal change handler
// see the correct value.
function clickStarRadio(container: HTMLElement, value: string) {
  const input = container.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${value}"]`,
  );
  if (!input) throw new Error(`no radio with value="${value}"`);
  fireEvent.click(input);
}

describe('StarsSelect', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the label and the "any" caption when no minimum is set', () => {
    render(<StarsSelect value={undefined} onChange={vi.fn()} />);
    expect(screen.getByText('Min stars')).toBeInTheDocument();
    expect(screen.getByText('any')).toBeInTheDocument();
  });

  it('renders "N+" when a minimum is set', () => {
    render(<StarsSelect value={3} onChange={vi.fn()} />);
    expect(screen.getByText('3+')).toBeInTheDocument();
  });

  it('emits the star value when clicked', () => {
    const onChange = vi.fn();
    const { container } = render(
      <StarsSelect value={undefined} onChange={onChange} />,
    );

    clickStarRadio(container, '4');
    expect(onChange).toHaveBeenCalledExactlyOnceWith(4);
  });

  it('emits undefined when the "Empty" affordance is clicked', () => {
    const onChange = vi.fn();
    const { container } = render(
      <StarsSelect value={3} onChange={onChange} />,
    );

    // The Empty radio has value="", which MUI parses to NaN and forwards
    // as null to our onChange — the widget then normalises null to
    // undefined for the "no filter" contract.
    clickStarRadio(container, '');
    expect(onChange).toHaveBeenCalledExactlyOnceWith(undefined);
  });

  it('accepts a custom label', () => {
    render(
      <StarsSelect value={undefined} onChange={vi.fn()} label="Rating floor" />,
    );
    expect(screen.getByText('Rating floor')).toBeInTheDocument();
  });
});
