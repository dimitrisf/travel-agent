// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { FlightHeaderRow } from './FlightHeaderRow';

describe('FlightHeaderRow', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the three sortable columns', () => {
    render(
      <FlightHeaderRow
        sort={{ mode: 'price', direction: 'asc' }}
        onSort={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Departure/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Duration/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Total/ })).toBeInTheDocument();
  });

  it('forwards onSort with the correct mode when a header is clicked', async () => {
    const onSort = vi.fn();
    const user = userEvent.setup();
    render(
      <FlightHeaderRow
        sort={{ mode: 'price', direction: 'asc' }}
        onSort={onSort}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Departure/ }));
    expect(onSort).toHaveBeenCalledExactlyOnceWith({
      mode: 'departure',
      direction: 'asc',
    });
  });

  it('maps the Total header to the price mode', async () => {
    const onSort = vi.fn();
    const user = userEvent.setup();
    render(
      <FlightHeaderRow
        sort={{ mode: 'departure', direction: 'asc' }}
        onSort={onSort}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Total/ }));
    expect(onSort).toHaveBeenCalledExactlyOnceWith({
      mode: 'price',
      direction: 'asc',
    });
  });
});
