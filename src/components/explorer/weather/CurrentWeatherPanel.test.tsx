// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CurrentWeatherPanel } from './CurrentWeatherPanel';
import type { CurrentWeatherResult } from '@/types/weather';

// Helper: build a Response-shaped object the way explorerFetch reads
// it (ok, status, json()). Real fetch semantics without pulling in MSW.
function mockOk(body: unknown, status = 200) {
  return {
    ok: true,
    status,
    json: async () => body,
  } as unknown as Response;
}
function mockErr(body: unknown, status: number) {
  return {
    ok: false,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('CurrentWeatherPanel', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the panel header and city field with the default value', () => {
    render(<CurrentWeatherPanel />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Current weather' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'City' })).toHaveValue(
      'Athens',
    );
  });

  it('fetches, transitions through loading, and renders the pretty result on success', async () => {
    const payload: CurrentWeatherResult = {
      city: 'Athens',
      tempC: 32,
      conditions: 'sunny',
      units: 'celsius',
    };
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockOk(payload),
    );

    const user = userEvent.setup();
    render(<CurrentWeatherPanel />);

    await user.click(screen.getByRole('button', { name: /Fetch current/ }));

    // The success-path rendering flows through CurrentWeatherResults —
    // asserting the temperature is enough to prove the whole pipeline
    // (form → fetch → state → renderPretty) wired up.
    expect(await screen.findByText('32°C')).toBeInTheDocument();
    expect(screen.getByText('sunny')).toBeInTheDocument();

    // Confirm the built URL was actually what got requested.
    expect(global.fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/weather/current?city=Athens',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('surfaces a typed API error in the response panel', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockErr(
        { error: { code: 'CITY_NOT_FOUND', message: 'City "Foo" not found.' } },
        404,
      ),
    );

    const user = userEvent.setup();
    render(<CurrentWeatherPanel />);

    await user.click(screen.getByRole('button', { name: /Fetch current/ }));

    expect(await screen.findByText('CITY_NOT_FOUND')).toBeInTheDocument();
    expect(screen.getByText('City "Foo" not found.')).toBeInTheDocument();
  });

  it('rehydrates a previously-persisted response on mount', async () => {
    const stored = {
      kind: 'success' as const,
      status: 200,
      timing: 12,
      data: {
        city: 'Berlin',
        tempC: 24,
        conditions: 'clear',
        units: 'celsius' as const,
      },
    };
    sessionStorage.setItem(
      'explorer:weather:current:state',
      JSON.stringify(stored),
    );
    sessionStorage.setItem(
      'explorer:weather:current:city',
      JSON.stringify('Berlin'),
    );

    render(<CurrentWeatherPanel />);

    // Persisted state hydrates in a useEffect after the initial paint —
    // findBy waits for the re-render.
    expect(await screen.findByText('24°C')).toBeInTheDocument();
    expect(screen.getByText('clear')).toBeInTheDocument();
    // No fetch should fire on mount.
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
