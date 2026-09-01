// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ForecastPanel } from './ForecastPanel';
import type { ForecastResult } from '@/types/weather';

function mockOk(body: unknown, status = 200) {
  return {
    ok: true,
    status,
    json: async () => body,
  } as unknown as Response;
}

function makeForecast(overrides: Partial<ForecastResult> = {}): ForecastResult {
  return {
    city: 'Athens',
    units: 'celsius',
    requestedDays: 3,
    providedDays: 3,
    days: [
      { date: '2026-09-15', tempCMin: 20, tempCMax: 30, conditions: 'sunny' },
      { date: '2026-09-16', tempCMin: 21, tempCMax: 31, conditions: 'clear' },
      { date: '2026-09-17', tempCMin: 22, tempCMax: 32, conditions: 'sunny' },
    ],
    ...overrides,
  };
}

describe('ForecastPanel', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the panel header and default 3-day query', () => {
    render(<ForecastPanel />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Forecast' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'City' })).toHaveValue(
      'Athens',
    );
    // Days is a number input; the default is 3.
    expect(screen.getByRole('spinbutton', { name: 'Days' })).toHaveValue(3);
  });

  it('fetches with city + days and renders the pretty result on success', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOk(makeForecast()),
    );

    const user = userEvent.setup();
    render(<ForecastPanel />);

    await user.click(screen.getByRole('button', { name: /Fetch forecast/ }));

    // ForecastResults renders one row per day plus a summary caption —
    // asserting the summary is enough for the full-flow test.
    expect(await screen.findByText('Athens · 3 of 3 days')).toBeInTheDocument();
    expect(screen.getByText('2026-09-15')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/weather/forecast?city=Athens&days=3',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('reflects the days input in the built URL', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOk(makeForecast({ requestedDays: 5, providedDays: 5 })),
    );

    const user = userEvent.setup();
    render(<ForecastPanel />);

    // Set the value directly. user.clear on a controlled number input
    // that ignores NaN (as the widget does) leaves the DOM reverting
    // to the previous state, so user.type would append rather than
    // replace. fireEvent.change bypasses that dance and just fires
    // one change with the target value.
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Days' }), {
      target: { value: '5' },
    });
    await user.click(screen.getByRole('button', { name: /Fetch forecast/ }));

    expect(global.fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/weather/forecast?city=Athens&days=5',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rehydrates a previously-persisted response on mount', async () => {
    sessionStorage.setItem(
      'explorer:weather:forecast:state',
      JSON.stringify({
        kind: 'success',
        status: 200,
        timing: 42,
        data: makeForecast({ city: 'Berlin' }),
      }),
    );
    sessionStorage.setItem(
      'explorer:weather:forecast:city',
      JSON.stringify('Berlin'),
    );

    render(<ForecastPanel />);

    expect(await screen.findByText('Berlin · 3 of 3 days')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
