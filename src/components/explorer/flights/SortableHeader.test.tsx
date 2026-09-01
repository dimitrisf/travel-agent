// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SortableHeader } from './SortableHeader';
import type { SortSpec } from '@/lib/explorer/flights/sort';

describe('SortableHeader', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the label as a button', () => {
    render(
      <SortableHeader
        label="Price"
        mode="price"
        sort={{ mode: 'price', direction: 'asc' }}
        onSort={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Price/ })).toBeInTheDocument();
  });

  it('emits asc when an inactive header is clicked', async () => {
    const onSort = vi.fn();
    const user = userEvent.setup();
    render(
      <SortableHeader
        label="Duration"
        mode="duration"
        sort={{ mode: 'price', direction: 'asc' }}
        onSort={onSort}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Duration/ }));
    expect(onSort).toHaveBeenCalledExactlyOnceWith({
      mode: 'duration',
      direction: 'asc',
    });
  });

  it('flips asc → desc when the active header is clicked', async () => {
    const onSort = vi.fn();
    const user = userEvent.setup();
    const sort: SortSpec = { mode: 'price', direction: 'asc' };
    render(
      <SortableHeader label="Price" mode="price" sort={sort} onSort={onSort} />,
    );

    await user.click(screen.getByRole('button', { name: /Price/ }));
    expect(onSort).toHaveBeenCalledExactlyOnceWith({
      mode: 'price',
      direction: 'desc',
    });
  });

  it('flips desc → asc when the active header is clicked', async () => {
    const onSort = vi.fn();
    const user = userEvent.setup();
    const sort: SortSpec = { mode: 'price', direction: 'desc' };
    render(
      <SortableHeader label="Price" mode="price" sort={sort} onSort={onSort} />,
    );

    await user.click(screen.getByRole('button', { name: /Price/ }));
    expect(onSort).toHaveBeenCalledExactlyOnceWith({
      mode: 'price',
      direction: 'asc',
    });
  });

  it('is keyboard-operable via Enter and Space', async () => {
    const onSort = vi.fn();
    const user = userEvent.setup();
    render(
      <SortableHeader
        label="Duration"
        mode="duration"
        sort={{ mode: 'price', direction: 'asc' }}
        onSort={onSort}
      />,
    );

    const btn = screen.getByRole('button', { name: /Duration/ });
    btn.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onSort).toHaveBeenCalledTimes(2);
  });

  it('includes direction in the aria-label only when active', () => {
    const { rerender } = render(
      <SortableHeader
        label="Price"
        mode="price"
        sort={{ mode: 'duration', direction: 'asc' }}
        onSort={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Sort by Price' }),
    ).toBeInTheDocument();

    rerender(
      <SortableHeader
        label="Price"
        mode="price"
        sort={{ mode: 'price', direction: 'desc' }}
        onSort={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Sort by Price (desc)' }),
    ).toBeInTheDocument();
  });
});
