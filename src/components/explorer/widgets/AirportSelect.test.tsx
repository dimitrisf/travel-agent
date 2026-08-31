// @vitest-environment jsdom

import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AirportSelect } from './AirportSelect';
import { CITIES } from '@/lib/cities';

// See CitySelect.test.tsx for why a stateful wrapper is needed for
// controlled-inputValue Autocomplete widgets.
function Wrapper({
  initial = '',
  onChange,
  ...rest
}: {
  initial?: string;
  onChange: (v: string) => void;
} & Partial<Parameters<typeof AirportSelect>[0]>) {
  const [v, setV] = useState(initial);
  return (
    <AirportSelect
      {...rest}
      value={v}
      onChange={(next) => {
        setV(next);
        onChange(next);
      }}
    />
  );
}

describe('AirportSelect', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the IATA value as its "IATA — City" label in the input', () => {
    render(<AirportSelect value="ATH" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Airport' })).toHaveValue(
      'ATH — Athens',
    );
  });

  it('shows one option per city in the dropdown', async () => {
    const user = userEvent.setup();
    render(<AirportSelect value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox', { name: 'Airport' }));
    const listbox = await screen.findByRole('listbox');

    for (const [city, { iata }] of Object.entries(CITIES)) {
      expect(
        within(listbox).getByRole('option', { name: `${iata} — ${city}` }),
      ).toBeInTheDocument();
    }
  });

  it('reports the raw IATA (not the label) when an option is selected', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Wrapper onChange={onChange} />);

    await user.click(screen.getByRole('combobox', { name: 'Airport' }));
    const listbox = await screen.findByRole('listbox');
    await user.click(
      within(listbox).getByRole('option', { name: 'BER — Berlin' }),
    );

    // Downstream state should receive 'BER', not the display label — the
    // API expects a bare IATA code.
    expect(onChange).toHaveBeenLastCalledWith('BER');
  });

  it('uppercases free-typed input', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Wrapper onChange={onChange} />);

    await user.type(screen.getByRole('combobox', { name: 'Airport' }), 'xyz');

    // Free-typing goes through the 'input' reason branch which
    // upper-cases so we can trigger the server's AIRPORT_NOT_FOUND path.
    expect(onChange).toHaveBeenLastCalledWith('XYZ');
  });

  it('excludes the excluded IATA from the dropdown', async () => {
    const user = userEvent.setup();
    render(
      <AirportSelect value="" onChange={vi.fn()} excludeIata="ATH" />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Airport' }));
    const listbox = await screen.findByRole('listbox');

    expect(
      within(listbox).queryByRole('option', { name: /^ATH/ }),
    ).not.toBeInTheDocument();
    // Sanity: the other seeded airports still appear.
    expect(
      within(listbox).getByRole('option', { name: /^BER/ }),
    ).toBeInTheDocument();
  });
});
