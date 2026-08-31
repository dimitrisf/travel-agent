// @vitest-environment jsdom

import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CitySelect } from './CitySelect';
import { CITY_NAMES } from '@/lib/cities';

// Stateful wrapper — CitySelect's inputValue is fully controlled, so a
// bare vi.fn() as onChange leaves the input stuck at its initial value
// and each keystroke replaces rather than appends. Real usage always
// has parent state feeding the value back in; the wrapper simulates
// that so multi-character typing tests work.
function Wrapper({
  initial = '',
  onChange,
  ...rest
}: {
  initial?: string;
  onChange: (v: string) => void;
} & Partial<Parameters<typeof CitySelect>[0]>) {
  const [v, setV] = useState(initial);
  return (
    <CitySelect
      {...rest}
      value={v}
      onChange={(next) => {
        setV(next);
        onChange(next);
      }}
    />
  );
}

describe('CitySelect', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the initial value in the input', () => {
    render(<CitySelect value="Athens" onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'City' })).toHaveValue('Athens');
  });

  it('uses a custom label', () => {
    render(<CitySelect value="" onChange={vi.fn()} label="Origin city" />);
    expect(
      screen.getByRole('combobox', { name: 'Origin city' }),
    ).toBeInTheDocument();
  });

  it('shows every seeded city as an option when opened', async () => {
    const user = userEvent.setup();
    render(<CitySelect value="" onChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox', { name: 'City' }));
    const listbox = await screen.findByRole('listbox');

    for (const city of CITY_NAMES) {
      expect(
        within(listbox).getByRole('option', { name: city }),
      ).toBeInTheDocument();
    }
  });

  it('reports the full typed string via onChange', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Wrapper onChange={onChange} />);

    await user.type(screen.getByRole('combobox', { name: 'City' }), 'Par');

    expect(onChange).toHaveBeenLastCalledWith('Par');
  });

  it('reports the selected option via onChange', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Wrapper onChange={onChange} />);

    await user.click(screen.getByRole('combobox', { name: 'City' }));
    const listbox = await screen.findByRole('listbox');
    await user.click(within(listbox).getByRole('option', { name: 'Berlin' }));

    expect(onChange).toHaveBeenLastCalledWith('Berlin');
  });

  it('propagates disabled to the input', () => {
    render(<CitySelect value="Athens" onChange={vi.fn()} disabled />);
    expect(screen.getByRole('combobox', { name: 'City' })).toBeDisabled();
  });

  it('applies the width prop to the root', () => {
    const { container } = render(
      <CitySelect value="" onChange={vi.fn()} width={400} />,
    );
    const root = container.querySelector('.MuiAutocomplete-root');
    expect(root).toHaveStyle({ width: '400px' });
  });
});
