// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { PageHeader } from './PageHeader';

describe('PageHeader', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the title as an h1', () => {
    render(<PageHeader title="Flights" description="anything" />);
    // The Typography variant is "h4" but component="h1" — the level 1
    // matters for document outline, the visual variant is styling.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Flights' }),
    ).toBeInTheDocument();
  });

  it('renders the description text', () => {
    render(<PageHeader title="X" description="A long-form description." />);
    expect(
      screen.getByText('A long-form description.'),
    ).toBeInTheDocument();
  });

  it('accepts ReactNode for description', () => {
    render(
      <PageHeader
        title="X"
        description={
          <>
            plain text with <strong>emphasis</strong>
          </>
        }
      />,
    );
    expect(screen.getByText('emphasis')).toBeInTheDocument();
  });
});
