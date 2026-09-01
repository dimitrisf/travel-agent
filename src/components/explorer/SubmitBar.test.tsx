// @vitest-environment jsdom

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SubmitBar } from './SubmitBar';

// CurlButton has its own tests. Stub it here so we can assert the
// composition contract (that SubmitBar renders one and hands it the
// curl props) without pulling in the clipboard/snackbar machinery.
vi.mock('./CurlButton', () => ({
  CurlButton: (props: { path: string; disabled?: boolean }) => (
    <button data-testid="curl-stub" data-path={props.path} disabled={props.disabled}>
      Copy as curl
    </button>
  ),
}));

describe('SubmitBar', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the submit label', () => {
    render(
      <SubmitBar
        submitLabel="Search flights"
        onSubmit={vi.fn()}
        curl={{ method: 'GET', path: '/api/flights' }}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Search flights' }),
    ).toBeInTheDocument();
  });

  it('calls onSubmit when the submit button is clicked', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SubmitBar
        submitLabel="Go"
        onSubmit={onSubmit}
        curl={{ method: 'GET', path: '/x' }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Go' }));
    // Button forwards onClick={onSubmit} as-is, so the MouseEvent is
    // passed through — asserting the click count is what matters.
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('disables submit (and curl) while submitting', () => {
    render(
      <SubmitBar
        submitLabel="Go"
        onSubmit={vi.fn()}
        submitting
        curl={{ method: 'GET', path: '/x' }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
    expect(screen.getByTestId('curl-stub')).toBeDisabled();
  });

  it('omits the Reset button when onReset is not provided', () => {
    render(
      <SubmitBar
        submitLabel="Go"
        onSubmit={vi.fn()}
        curl={{ method: 'GET', path: '/x' }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
  });

  it('renders the Reset button when onReset is provided and calls it on click', async () => {
    const onReset = vi.fn();
    const user = userEvent.setup();
    render(
      <SubmitBar
        submitLabel="Go"
        onSubmit={vi.fn()}
        onReset={onReset}
        curl={{ method: 'GET', path: '/x' }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('forwards the curl props to CurlButton', () => {
    render(
      <SubmitBar
        submitLabel="Go"
        onSubmit={vi.fn()}
        curl={{ method: 'GET', path: '/api/weather/current?city=Berlin' }}
      />,
    );
    expect(screen.getByTestId('curl-stub')).toHaveAttribute(
      'data-path',
      '/api/weather/current?city=Berlin',
    );
  });
});
