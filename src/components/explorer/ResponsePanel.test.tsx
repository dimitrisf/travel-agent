// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ResponsePanel } from './ResponsePanel';
import type { ResponseState } from '@/lib/explorer/explorerTypes';

type Payload = { city: string; tempC: number };

const pretty = (data: Payload) => (
  <div data-testid="pretty">
    {data.city}:{data.tempC}
  </div>
);

describe('ResponsePanel', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when idle', () => {
    const state: ResponseState<Payload> = { kind: 'idle' };
    const { container } = render(
      <ResponsePanel state={state} renderPretty={pretty} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a spinner while loading', () => {
    const state: ResponseState<Payload> = { kind: 'loading' };
    render(<ResponsePanel state={state} renderPretty={pretty} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders the error code and message on error', () => {
    const state: ResponseState<Payload> = {
      kind: 'error',
      status: 404,
      timing: 23,
      error: { code: 'CITY_NOT_FOUND', message: 'City "Paris" not found.' },
    };
    render(<ResponsePanel state={state} renderPretty={pretty} />);
    expect(screen.getByText('CITY_NOT_FOUND')).toBeInTheDocument();
    expect(screen.getByText('City "Paris" not found.')).toBeInTheDocument();
    // Meta row surfaces status + timing.
    expect(screen.getByText(/404 · 23ms/)).toBeInTheDocument();
  });

  it('omits the code chip when the error has no code (network failure)', () => {
    const state: ResponseState<Payload> = {
      kind: 'error',
      status: 0,
      timing: 5,
      error: { message: 'Network error' },
    };
    render(<ResponsePanel state={state} renderPretty={pretty} />);
    expect(screen.getByText('Network error')).toBeInTheDocument();
    // No code → the meta row shows ERR for status 0.
    expect(screen.getByText(/ERR · 5ms/)).toBeInTheDocument();
  });

  it('shows the pretty view by default on success and the raw JSON when Raw tab is clicked', async () => {
    const state: ResponseState<Payload> = {
      kind: 'success',
      status: 200,
      timing: 17,
      data: { city: 'Athens', tempC: 32 },
    };
    const user = userEvent.setup();
    render(<ResponsePanel state={state} renderPretty={pretty} />);

    // Pretty is the default active tab.
    expect(screen.getByTestId('pretty')).toBeInTheDocument();
    expect(screen.getByText('Athens:32')).toBeInTheDocument();

    // Switch to Raw — the pretty view unmounts and a JSON dump appears.
    await user.click(screen.getByRole('tab', { name: 'Raw' }));
    expect(screen.queryByTestId('pretty')).not.toBeInTheDocument();
    expect(
      screen.getByText(/"city": "Athens"/, { collapseWhitespace: false }),
    ).toBeInTheDocument();
    // Meta row still shows status + timing.
    expect(screen.getByText(/200 · 17ms/)).toBeInTheDocument();
  });
});
