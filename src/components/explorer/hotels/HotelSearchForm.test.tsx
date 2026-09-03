// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { todayLocalIsoDate } from '@/lib/explorer/today';
import { HotelSearchForm } from './HotelSearchForm';

describe('HotelSearchForm', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it('renders every form field with sensible defaults', () => {
    render(<HotelSearchForm submitting={false} onSearch={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'City' })).toHaveValue(
      'Athens',
    );
    expect(screen.getByLabelText('Check-in')).toBeInTheDocument();
    expect(screen.getByLabelText('Check-out')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Guests' })).toHaveValue('2');
    expect(screen.getByRole('textbox', { name: 'Rooms' })).toHaveValue('1');
    expect(screen.getByLabelText('Breakfast required')).toBeInTheDocument();
    expect(screen.getByLabelText('Free cancellation')).toBeInTheDocument();
    expect(screen.getByLabelText('Pet friendly')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Search hotels/ }),
    ).toBeInTheDocument();
  });

  it('emits the minimal query URL on submit with defaults', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<HotelSearchForm submitting={false} onSearch={onSearch} />);

    await user.click(screen.getByRole('button', { name: /Search hotels/ }));

    // Dates are empty by default; guests=2 and rooms=1 are the API's
    // defaults so both are omitted from the built URL.
    expect(onSearch).toHaveBeenCalledExactlyOnceWith({
      path: '/api/hotels?city=Athens',
    });
  });

  it('shows a warning and disables submit when checkout <= checkin', async () => {
    sessionStorage.setItem(
      'explorer:hotels:checkin',
      JSON.stringify('2026-09-15'),
    );
    sessionStorage.setItem(
      'explorer:hotels:checkout',
      JSON.stringify('2026-09-15'),
    );

    render(<HotelSearchForm submitting={false} onSearch={vi.fn()} />);

    expect(
      await screen.findByText('Check-out must be after check-in.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Search hotels/ }),
    ).toBeDisabled();
  });

  it('short-circuits onSearch when the date-range guard is active', async () => {
    sessionStorage.setItem(
      'explorer:hotels:checkin',
      JSON.stringify('2026-09-15'),
    );
    sessionStorage.setItem(
      'explorer:hotels:checkout',
      JSON.stringify('2026-09-15'),
    );
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<HotelSearchForm submitting={false} onSearch={onSearch} />);
    await screen.findByText('Check-out must be after check-in.');

    await user
      .click(screen.getByRole('button', { name: /Search hotels/ }))
      .catch(() => {
        /* disabled */
      });
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('includes non-default params in the query when they diverge', async () => {
    sessionStorage.setItem('explorer:hotels:guests', JSON.stringify(4));
    sessionStorage.setItem('explorer:hotels:rooms', JSON.stringify(2));
    sessionStorage.setItem('explorer:hotels:minStars', JSON.stringify(4));
    sessionStorage.setItem('explorer:hotels:maxPrice', JSON.stringify(250));
    sessionStorage.setItem(
      'explorer:hotels:breakfastRequired',
      JSON.stringify(true),
    );
    sessionStorage.setItem(
      'explorer:hotels:freeCancellation',
      JSON.stringify(true),
    );
    sessionStorage.setItem(
      'explorer:hotels:petFriendly',
      JSON.stringify(true),
    );

    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<HotelSearchForm submitting={false} onSearch={onSearch} />);

    await screen.findByRole('button', { name: /Search hotels/ });
    await user.click(screen.getByRole('button', { name: /Search hotels/ }));

    expect(onSearch).toHaveBeenCalledExactlyOnceWith({
      path: '/api/hotels?city=Athens&guests=4&rooms=2&min_stars=4&max_price=250&breakfast_required=true&free_cancellation=true&pet_friendly=true',
    });
  });

  it('forwards submitting to the SubmitBar', () => {
    render(<HotelSearchForm submitting onSearch={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: /Search hotels/ }),
    ).toBeDisabled();
  });

  it('sets min=today on both date inputs so the picker greys out past days', () => {
    render(<HotelSearchForm submitting={false} onSearch={vi.fn()} />);
    const today = todayLocalIsoDate();
    expect(screen.getByLabelText('Check-in')).toHaveAttribute('min', today);
    expect(screen.getByLabelText('Check-out')).toHaveAttribute('min', today);
  });

  it('warns and disables submit when a persisted date is in the past', async () => {
    // Simulates the day-rollover case: values were stored in
    // sessionStorage on some previous visit and are now older than
    // today. `min` on the input only constrains the picker, not the
    // rehydrated state — the guard has to catch it.
    sessionStorage.setItem(
      'explorer:hotels:checkin',
      JSON.stringify('2000-01-01'),
    );
    sessionStorage.setItem(
      'explorer:hotels:checkout',
      JSON.stringify('2000-01-02'),
    );
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<HotelSearchForm submitting={false} onSearch={onSearch} />);

    expect(
      await screen.findByText('Dates cannot be in the past.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Search hotels/ }),
    ).toBeDisabled();

    await user
      .click(screen.getByRole('button', { name: /Search hotels/ }))
      .catch(() => {
        /* disabled */
      });
    expect(onSearch).not.toHaveBeenCalled();
  });
});
