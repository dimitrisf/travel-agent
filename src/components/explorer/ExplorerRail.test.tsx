// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// ExplorerRail reads usePathname() to decide which entry is active.
// Mock next/navigation so each test can dictate the "current" route.
vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}));

import { ExplorerRail } from './ExplorerRail';
import { usePathname } from 'next/navigation';

const usePathnameMock = vi.mocked(usePathname);

const ENTRIES = [
  { label: 'Weather', href: '/explorer/weather' },
  { label: 'Flights', href: '/explorer/flights' },
  { label: 'Hotels', href: '/explorer/hotels' },
  { label: 'Booking', href: '/explorer/booking' },
];

describe('ExplorerRail', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders one link per endpoint', () => {
    usePathnameMock.mockReturnValue('/explorer');
    render(<ExplorerRail />);

    for (const { label, href } of ENTRIES) {
      const link = screen.getByRole('link', { name: label });
      expect(link).toHaveAttribute('href', href);
    }
  });

  it('marks the entry matching the current pathname as selected', () => {
    usePathnameMock.mockReturnValue('/explorer/flights');
    render(<ExplorerRail />);

    // MUI ListItemButton with selected={true} adds Mui-selected;
    // the class is stable across MUI 6 minors.
    const flightsLink = screen.getByRole('link', { name: 'Flights' });
    expect(flightsLink).toHaveClass('Mui-selected');

    for (const { label } of ENTRIES.filter((e) => e.label !== 'Flights')) {
      expect(screen.getByRole('link', { name: label })).not.toHaveClass(
        'Mui-selected',
      );
    }
  });

  it('activates a different entry when the pathname changes', () => {
    usePathnameMock.mockReturnValue('/explorer/hotels');
    render(<ExplorerRail />);
    expect(screen.getByRole('link', { name: 'Hotels' })).toHaveClass(
      'Mui-selected',
    );
  });

  it('selects no entry on the /explorer index (exact-match highlight)', () => {
    usePathnameMock.mockReturnValue('/explorer');
    render(<ExplorerRail />);
    for (const { label } of ENTRIES) {
      expect(screen.getByRole('link', { name: label })).not.toHaveClass(
        'Mui-selected',
      );
    }
  });

  it('exposes an aria-label on the nav landmark', () => {
    usePathnameMock.mockReturnValue('/explorer');
    render(<ExplorerRail />);
    expect(
      screen.getByRole('navigation', { name: 'Explorer endpoints' }),
    ).toBeInTheDocument();
  });
});
