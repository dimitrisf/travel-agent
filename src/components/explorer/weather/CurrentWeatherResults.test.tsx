// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { CurrentWeatherResults } from './CurrentWeatherResults';
import type { CurrentWeatherResult } from '@/types/weather';

function make(overrides: Partial<CurrentWeatherResult> = {}): CurrentWeatherResult {
  return {
    city: 'Athens',
    tempC: 32,
    conditions: 'sunny',
    units: 'celsius',
    ...overrides,
  };
}

describe('CurrentWeatherResults', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the city, temperature, and conditions', () => {
    render(<CurrentWeatherResults data={make()} />);
    expect(screen.getByText('Athens')).toBeInTheDocument();
    expect(screen.getByText('32°C')).toBeInTheDocument();
    expect(screen.getByText('sunny')).toBeInTheDocument();
  });

  it('renders whatever temperature the payload carries', () => {
    render(<CurrentWeatherResults data={make({ tempC: -5 })} />);
    expect(screen.getByText('-5°C')).toBeInTheDocument();
  });
});
