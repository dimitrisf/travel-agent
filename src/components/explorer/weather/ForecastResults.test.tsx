// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { ForecastResults } from './ForecastResults';
import type { ForecastResult } from '@/types/weather';

function make(overrides: Partial<ForecastResult> = {}): ForecastResult {
  return {
    city: 'Berlin',
    units: 'celsius',
    requestedDays: 3,
    providedDays: 3,
    days: [
      { date: '2026-09-15', tempCMin: 12, tempCMax: 20, conditions: 'clear' },
      { date: '2026-09-16', tempCMin: 13, tempCMax: 22, conditions: 'sunny' },
      { date: '2026-09-17', tempCMin: 11, tempCMax: 19, conditions: 'cloudy' },
    ],
    ...overrides,
  };
}

describe('ForecastResults', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders one row per day', () => {
    render(<ForecastResults data={make()} />);
    expect(screen.getByText('2026-09-15')).toBeInTheDocument();
    expect(screen.getByText('2026-09-16')).toBeInTheDocument();
    expect(screen.getByText('2026-09-17')).toBeInTheDocument();
    expect(screen.getByText('12° – 20°C')).toBeInTheDocument();
    expect(screen.getByText('clear')).toBeInTheDocument();
  });

  it('renders the summary line without a "capped" note when the counts match', () => {
    render(<ForecastResults data={make()} />);
    expect(
      screen.getByText('Berlin · 3 of 3 days'),
    ).toBeInTheDocument();
  });

  it('adds "(capped by provider)" when providedDays < requestedDays', () => {
    render(
      <ForecastResults
        data={make({ requestedDays: 7, providedDays: 5, days: make().days })}
      />,
    );
    expect(
      screen.getByText(/Berlin · 5 of 7 days \(capped by provider\)/),
    ).toBeInTheDocument();
  });

  it('renders singular "day" for a single-day forecast', () => {
    render(
      <ForecastResults
        data={make({ requestedDays: 1, providedDays: 1, days: [make().days[0]] })}
      />,
    );
    expect(screen.getByText('Berlin · 1 of 1 day')).toBeInTheDocument();
  });
});
