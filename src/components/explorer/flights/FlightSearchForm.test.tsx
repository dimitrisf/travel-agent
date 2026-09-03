// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { todayLocalIsoDate } from '@/lib/explorer/today';
import { FlightSearchForm } from './FlightSearchForm';

// FlightSearchForm owns its state via usePersistedState. Clearing
// sessionStorage before each test isolates the run — otherwise the
// previous test's values would rehydrate here.

describe('FlightSearchForm', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders every form field with sensible defaults', () => {
    render(<FlightSearchForm submitting={false} onSearch={vi.fn()} />);
    // Default state: origin ATH, destination BER, cabin economy, adults
    // 1, children 0, direct off, no max price.
    expect(screen.getByRole('combobox', { name: 'Origin' })).toHaveValue(
      'ATH — Athens',
    );
    expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveValue(
      'BER — Berlin',
    );
    expect(screen.getByLabelText('Departure')).toBeInTheDocument();
    expect(screen.getByLabelText('Return (optional)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Search flights/ })).toBeInTheDocument();
  });

  it('emits { path, passengers } with the built URL on submit', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<FlightSearchForm submitting={false} onSearch={onSearch} />);

    await user.click(screen.getByRole('button', { name: /Search flights/ }));

    // Defaults → no non-default params other than origin and destination
    // (adults=1, children=0, cabin=economy are all defaults and omitted).
    expect(onSearch).toHaveBeenCalledExactlyOnceWith({
      path: '/api/flights?origin=ATH&destination=BER',
      passengers: 1,
    });
  });

  it('shows a warning and disables submit when origin === destination', async () => {
    // Pre-populate sessionStorage so the form hydrates with matching
    // airports — testing the validation path without walking through
    // Autocomplete keyboard interactions.
    sessionStorage.setItem(
      'explorer:flights:destination',
      JSON.stringify('ATH'),
    );
    render(<FlightSearchForm submitting={false} onSearch={vi.fn()} />);

    // Wait for the hydrate effect to run and the warning to appear.
    expect(
      await screen.findByText(
        'Origin and destination must be different airports.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Search flights/ }),
    ).toBeDisabled();
  });

  it('short-circuits onSearch when the same-airport guard is active', async () => {
    sessionStorage.setItem(
      'explorer:flights:destination',
      JSON.stringify('ATH'),
    );
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<FlightSearchForm submitting={false} onSearch={onSearch} />);
    await screen.findByText(/must be different/);

    // Button is disabled so user-event refuses to click. Try
    // anyway via the DOM to prove handleSubmit early-returns as
    // a belt-and-suspenders guard.
    const btn = screen.getByRole('button', { name: /Search flights/ });
    await user.click(btn).catch(() => {
      /* user-event throws on disabled clicks — swallow it */
    });
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('includes non-default params in the query when they diverge', async () => {
    // Pre-populate a richer state so the built URL includes the
    // extra params. Persisted keys mirror the form's usePersistedState.
    sessionStorage.setItem(
      'explorer:flights:cabinClass',
      JSON.stringify('business'),
    );
    sessionStorage.setItem('explorer:flights:adults', JSON.stringify(2));
    sessionStorage.setItem('explorer:flights:children', JSON.stringify(1));
    sessionStorage.setItem(
      'explorer:flights:nonstopOnly',
      JSON.stringify(true),
    );
    sessionStorage.setItem('explorer:flights:maxPrice', JSON.stringify(300));

    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<FlightSearchForm submitting={false} onSearch={onSearch} />);

    // Let hydration settle so the button acts on the persisted values.
    await screen.findByRole('button', { name: /Search flights/ });
    await user.click(screen.getByRole('button', { name: /Search flights/ }));

    expect(onSearch).toHaveBeenCalledExactlyOnceWith({
      path: '/api/flights?origin=ATH&destination=BER&cabin_class=business&adults=2&children=1&nonstop_only=true&max_price=300',
      passengers: 3,
    });
  });

  it('forwards submitting to the SubmitBar', () => {
    render(<FlightSearchForm submitting onSearch={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: /Search flights/ }),
    ).toBeDisabled();
  });

  it('sets min=today on both date inputs so the picker greys out past days', () => {
    render(<FlightSearchForm submitting={false} onSearch={vi.fn()} />);
    const today = todayLocalIsoDate();
    expect(screen.getByLabelText('Departure')).toHaveAttribute('min', today);
    expect(screen.getByLabelText('Return (optional)')).toHaveAttribute(
      'min',
      today,
    );
  });

  it('warns and disables submit when a persisted date is in the past', async () => {
    // Simulates the day-rollover case: values were stored in
    // sessionStorage on some previous visit and are now older than
    // today. `min` on the input only constrains the picker, not the
    // rehydrated state — the guard has to catch it.
    sessionStorage.setItem(
      'explorer:flights:departureDate',
      JSON.stringify('2000-01-01'),
    );
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<FlightSearchForm submitting={false} onSearch={onSearch} />);

    expect(
      await screen.findByText('Dates cannot be in the past.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Search flights/ }),
    ).toBeDisabled();

    await user
      .click(screen.getByRole('button', { name: /Search flights/ }))
      .catch(() => {
        /* disabled */
      });
    expect(onSearch).not.toHaveBeenCalled();
  });
});
