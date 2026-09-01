// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CurlButton } from './CurlButton';

// user-event v14 installs its own Clipboard API stub when
// userEvent.setup() runs, replacing anything we might set on
// navigator.clipboard. So instead of asserting on a mock writeText,
// we let the widget write via user-event's stub and read the value
// back with navigator.clipboard.readText().

describe('CurlButton', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders as a "Copy as curl" button', () => {
    render(<CurlButton method="GET" path="/api/x" />);
    expect(
      screen.getByRole('button', { name: /Copy as curl/ }),
    ).toBeInTheDocument();
  });

  it('writes a GET curl command containing the path to the clipboard', async () => {
    const user = userEvent.setup();
    render(
      <CurlButton method="GET" path="/api/weather/current?city=Berlin" />,
    );

    await user.click(screen.getByRole('button', { name: /Copy as curl/ }));

    const written = await navigator.clipboard.readText();
    expect(written).toMatch(/^curl "/);
    expect(written).toContain('/api/weather/current?city=Berlin');
  });

  it('writes a POST curl with a JSON body and content-type header', async () => {
    const user = userEvent.setup();
    render(
      <CurlButton
        method="POST"
        path="/api/booking/propose"
        body={{ flights: [{ id: 1 }] }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Copy as curl/ }));

    const written = await navigator.clipboard.readText();
    expect(written).toContain('curl -X POST');
    expect(written).toContain('/api/booking/propose');
    expect(written).toContain('-H "Content-Type: application/json"');
    // JSON.stringify(..., null, 2) preserves the shape verbatim.
    expect(written).toContain('"flights":');
    expect(written).toContain('"id": 1');
  });

  it('shows the "Copied to clipboard" snackbar after a successful copy', async () => {
    const user = userEvent.setup();
    render(<CurlButton method="GET" path="/api/x" />);

    await user.click(screen.getByRole('button', { name: /Copy as curl/ }));

    expect(await screen.findByText('Copied to clipboard')).toBeInTheDocument();
  });

  it('respects the disabled prop', async () => {
    const user = userEvent.setup();
    render(<CurlButton method="GET" path="/api/x" disabled />);

    const btn = screen.getByRole('button', { name: /Copy as curl/ });
    expect(btn).toBeDisabled();

    // user-event refuses to click disabled buttons — no snackbar
    // should appear, and the clipboard stays whatever it was.
    await user.click(btn).catch(() => {
      /* disabled */
    });
    expect(
      screen.queryByText('Copied to clipboard'),
    ).not.toBeInTheDocument();
  });
});
