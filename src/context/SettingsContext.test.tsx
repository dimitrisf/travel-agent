// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  SettingsProvider,
  useSettings,
  useDateLocale,
  useFormatDate,
} from './SettingsContext';

const STORAGE_KEY = 'app:settings:v1';

// Per-file auth mock replaces the default signed-out one in
// vitest.setup.ts. The fresh-object-literal shape mirrors the real
// useCurrentUser (which builds `{ id, email, ... }` on every render),
// so a regression that lists `currentUser` instead of `currentUser?.id`
// in the hydrate effect's deps would show up as an infinite fetch
// loop in tests here.
// The { ...mockCurrentUser } spread is the key — it rebuilds the object every call, exactly like the real one. A lazier mock (useCurrentUser: () => mockCurrentUser) would return the same object reference every render, so even a buggy [currentUser] dep list would look stable in tests and the regression would sail past CI.
// The test that cashes this in is the "fires exactly one GET per hydrate" one — it asserts expect(fetchMock).toHaveBeenCalledOnce() after a short settle. With the real dep list ([currentUser?.id]), you get exactly one GET. With a regression to [currentUser] plus the fresh-object mock, you'd get many — the test would blow up loudly.
let mockCurrentUser: { id: string; email: string } | null = null;
vi.mock('@/lib/auth/client', () => ({
  useCurrentUser: () => (mockCurrentUser ? { ...mockCurrentUser } : null),
}));

// DOM harness — exposes the current context state via testids and
// buttons for the setters. Keeps assertions in the same getByText /
// getByTestId style as the rest of the context tests.
function Harness() {
  const s = useSettings();
  const locale = useDateLocale();
  const fmt = useFormatDate();
  return (
    <div>
      <button onClick={() => s.setDateFormat('us')}>setFormatUS</button>
      <button onClick={() => s.setDateFormat('eu')}>setFormatEU</button>
      <button onClick={() => s.setDateFormat('auto')}>setFormatAuto</button>
      <button onClick={() => s.setThemeMode('dark')}>setThemeDark</button>
      <button onClick={() => s.setThemeMode('light')}>setThemeLight</button>
      <div data-testid="dateFormat">{s.dateFormat}</div>
      <div data-testid="themeMode">{s.themeMode}</div>
      <div data-testid="locale">{locale ?? 'undef'}</div>
      <div data-testid="formatted">{fmt('2026-03-04')}</div>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <SettingsProvider>
      <Harness />
    </SettingsProvider>,
  );
}

// Build a fetch mock that answers GET /api/settings with the given
// server row and succeeds on PATCH. Shared across the signed-in
// cases to keep each test focused on its one differentiator.
function makeFetchMock(serverRow: {
  dateFormat: string | null;
  themeMode: string | null;
}) {
  return vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') {
      return Promise.resolve({
        ok: true,
        json: async () => serverRow,
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

describe('SettingsContext', () => {
  beforeEach(() => {
    mockCurrentUser = null;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('defaults and `initial` prop', () => {
    it('starts at DEFAULTS when nothing is stored and the user is anonymous', () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      renderWithProvider();

      expect(screen.getByTestId('dateFormat')).toHaveTextContent('auto');
      expect(screen.getByTestId('themeMode')).toHaveTextContent('light');
      expect(screen.getByTestId('locale')).toHaveTextContent('undef');
      // Anonymous → never hits /api/settings.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('`initial` prop wins over localStorage and skips hydrate entirely', () => {
      // Even with a localStorage value, the hydrate effect short-
      // circuits when `initial !== undefined` — the test-ergonomic
      // escape hatch for deterministic locale rendering.
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ dateFormat: 'us', themeMode: 'dark' }),
      );
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      render(
        <SettingsProvider initial={{ dateFormat: 'eu', themeMode: 'light' }}>
          <Harness />
        </SettingsProvider>,
      );

      expect(screen.getByTestId('dateFormat')).toHaveTextContent('eu');
      expect(screen.getByTestId('themeMode')).toHaveTextContent('light');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('`initial` prop skips the server fetch even when a user is signed in', () => {
      mockCurrentUser = { id: 'u-1', email: 'u@example.com' };
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      render(
        <SettingsProvider initial={{ dateFormat: 'us' }}>
          <Harness />
        </SettingsProvider>,
      );

      expect(screen.getByTestId('dateFormat')).toHaveTextContent('us');
      // themeMode missing from `initial` falls back to the DEFAULT.
      expect(screen.getByTestId('themeMode')).toHaveTextContent('light');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('anonymous hydrate', () => {
    it('reads localStorage when the user is anonymous and does not fetch', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ dateFormat: 'us', themeMode: 'dark' }),
      );
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      renderWithProvider();

      expect(screen.getByTestId('dateFormat')).toHaveTextContent('us');
      expect(screen.getByTestId('themeMode')).toHaveTextContent('dark');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('falls back to DEFAULTS when localStorage holds an unparseable value', () => {
      localStorage.setItem(STORAGE_KEY, 'not-json');
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      renderWithProvider();

      expect(screen.getByTestId('dateFormat')).toHaveTextContent('auto');
      expect(screen.getByTestId('themeMode')).toHaveTextContent('light');
    });
  });

  describe('signed-in hydrate', () => {
    it('server-saved prefs win over local and write through to localStorage', async () => {
      mockCurrentUser = { id: 'u-1', email: 'u@example.com' };
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ dateFormat: 'eu', themeMode: 'light' }),
      );
      const fetchMock = makeFetchMock({
        dateFormat: 'us',
        themeMode: 'dark',
      });
      vi.stubGlobal('fetch', fetchMock);

      renderWithProvider();

      await waitFor(() =>
        expect(screen.getByTestId('dateFormat')).toHaveTextContent('us'),
      );
      expect(screen.getByTestId('themeMode')).toHaveTextContent('dark');
      // Write-through: localStorage now mirrors the server values.
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string)).toEqual({
        dateFormat: 'us',
        themeMode: 'dark',
      });
      // Only the GET fired — no PATCH echo back to the server.
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0][0]).toBe('/api/settings');
    });

    it('fills missing server fields from DEFAULTS when the row is half-populated', async () => {
      mockCurrentUser = { id: 'u-1', email: 'u@example.com' };
      const fetchMock = makeFetchMock({
        dateFormat: 'us',
        themeMode: null,
      });
      vi.stubGlobal('fetch', fetchMock);

      renderWithProvider();

      await waitFor(() =>
        expect(screen.getByTestId('dateFormat')).toHaveTextContent('us'),
      );
      // themeMode is null on the server → falls back to DEFAULT ('light').
      expect(screen.getByTestId('themeMode')).toHaveTextContent('light');
    });

    it('promotes local prefs to the server when the server row is empty', async () => {
      mockCurrentUser = { id: 'u-1', email: 'u@example.com' };
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ dateFormat: 'us', themeMode: 'dark' }),
      );
      const fetchMock = makeFetchMock({ dateFormat: null, themeMode: null });
      vi.stubGlobal('fetch', fetchMock);

      renderWithProvider();

      // Local snapshot stays applied.
      await waitFor(() =>
        expect(screen.getByTestId('dateFormat')).toHaveTextContent('us'),
      );
      expect(screen.getByTestId('themeMode')).toHaveTextContent('dark');

      // Promotion PATCH fires with the full local snapshot.
      await waitFor(() => {
        const patch = fetchMock.mock.calls.find(
          ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
        );
        expect(patch).toBeDefined();
      });
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      ) as [string, RequestInit];
      expect(patch[0]).toBe('/api/settings');
      expect(JSON.parse(patch[1].body as string)).toEqual({
        dateFormat: 'us',
        themeMode: 'dark',
      });
    });

    it('stays at DEFAULTS when both server and localStorage are empty', async () => {
      mockCurrentUser = { id: 'u-1', email: 'u@example.com' };
      const fetchMock = makeFetchMock({ dateFormat: null, themeMode: null });
      vi.stubGlobal('fetch', fetchMock);

      renderWithProvider();

      // Give the hydrate GET a chance to resolve.
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(screen.getByTestId('dateFormat')).toHaveTextContent('auto');
      expect(screen.getByTestId('themeMode')).toHaveTextContent('light');
      // No promote, no echo — only the one GET.
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('falls back to localStorage when the server GET returns non-2xx', async () => {
      mockCurrentUser = { id: 'u-1', email: 'u@example.com' };
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ dateFormat: 'eu', themeMode: 'dark' }),
      );
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'boom' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      renderWithProvider();

      await waitFor(() =>
        expect(screen.getByTestId('dateFormat')).toHaveTextContent('eu'),
      );
      expect(screen.getByTestId('themeMode')).toHaveTextContent('dark');
    });

    it('falls back to localStorage when the server GET rejects (network error)', async () => {
      mockCurrentUser = { id: 'u-1', email: 'u@example.com' };
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ dateFormat: 'eu', themeMode: 'light' }),
      );
      const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
      vi.stubGlobal('fetch', fetchMock);

      renderWithProvider();

      await waitFor(() =>
        expect(screen.getByTestId('dateFormat')).toHaveTextContent('eu'),
      );
    });

    it('fires exactly one GET per hydrate — guards against the useEffect-on-every-render loop', async () => {
      // Regression guard: if the hydrate effect's dep list ever lists
      // `currentUser` (object identity) instead of `currentUser?.id`
      // (primitive), the fresh-object-each-render mock above makes
      // every render retrigger the effect — snowballing into an
      // infinite GET /api/settings loop. One call per auth state
      // is the invariant.
      mockCurrentUser = { id: 'u-1', email: 'u@example.com' };
      const fetchMock = makeFetchMock({ dateFormat: null, themeMode: null });
      vi.stubGlobal('fetch', fetchMock);

      renderWithProvider();

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      // Let any renders after hydrate flush.
      await new Promise((r) => setTimeout(r, 20));
      expect(fetchMock).toHaveBeenCalledOnce();
    });
  });

  describe('setters', () => {
    it('setDateFormat updates state and persists to localStorage', async () => {
      const user = userEvent.setup();
      vi.stubGlobal('fetch', vi.fn());
      renderWithProvider();

      await user.click(screen.getByText('setFormatUS'));

      expect(screen.getByTestId('dateFormat')).toHaveTextContent('us');
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string)).toEqual({
        dateFormat: 'us',
        themeMode: 'light',
      });
    });

    it('setThemeMode updates state and persists to localStorage', async () => {
      const user = userEvent.setup();
      vi.stubGlobal('fetch', vi.fn());
      renderWithProvider();

      await user.click(screen.getByText('setThemeDark'));

      expect(screen.getByTestId('themeMode')).toHaveTextContent('dark');
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) as string)).toEqual({
        dateFormat: 'auto',
        themeMode: 'dark',
      });
    });

    it('does NOT PATCH /api/settings when the user is anonymous', async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      renderWithProvider();

      await user.click(screen.getByText('setFormatUS'));
      await user.click(screen.getByText('setThemeDark'));

      // Zero network traffic — localStorage is the sole backing store.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fires a fire-and-forget PATCH /api/settings when signed in', async () => {
      mockCurrentUser = { id: 'u-1', email: 'u@example.com' };
      const fetchMock = makeFetchMock({ dateFormat: null, themeMode: null });
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();
      renderWithProvider();

      // Let the hydrate GET settle so subsequent calls are the PATCH.
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      await user.click(screen.getByText('setFormatUS'));

      await waitFor(() => {
        const patch = fetchMock.mock.calls.find(
          ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
        );
        expect(patch).toBeDefined();
      });
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      ) as [string, RequestInit];
      expect(patch[0]).toBe('/api/settings');
      expect(patch[1].headers).toMatchObject({
        'Content-Type': 'application/json',
      });
      // Partial payload — only the field that changed, not the full state.
      expect(JSON.parse(patch[1].body as string)).toEqual({ dateFormat: 'us' });
    });

    it('PATCHes only the field that changed, not the whole state', async () => {
      mockCurrentUser = { id: 'u-1', email: 'u@example.com' };
      const fetchMock = makeFetchMock({ dateFormat: null, themeMode: null });
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();
      renderWithProvider();

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      await user.click(screen.getByText('setThemeDark'));

      await waitFor(() => {
        const patch = fetchMock.mock.calls.find(
          ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
        );
        expect(patch).toBeDefined();
      });
      const patch = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      ) as [string, RequestInit];
      expect(JSON.parse(patch[1].body as string)).toEqual({
        themeMode: 'dark',
      });
    });

    it('swallows PATCH errors silently and still updates local state', async () => {
      mockCurrentUser = { id: 'u-1', email: 'u@example.com' };
      const fetchMock = vi.fn().mockImplementation((_url, init) => {
        const method = (init as RequestInit | undefined)?.method ?? 'GET';
        if (method === 'GET') {
          return Promise.resolve({
            ok: true,
            json: async () => ({ dateFormat: null, themeMode: null }),
          });
        }
        return Promise.reject(new Error('network down'));
      });
      vi.stubGlobal('fetch', fetchMock);
      const user = userEvent.setup();
      renderWithProvider();

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());

      // The click must not throw even though the PATCH rejects.
      await user.click(screen.getByText('setFormatUS'));

      // State is still updated locally — the client's localStorage
      // remains the authoritative copy per the fire-and-forget policy.
      expect(screen.getByTestId('dateFormat')).toHaveTextContent('us');
    });
  });

  describe('useDateLocale', () => {
    it('maps `us` to en-US', () => {
      render(
        <SettingsProvider initial={{ dateFormat: 'us' }}>
          <Harness />
        </SettingsProvider>,
      );
      expect(screen.getByTestId('locale')).toHaveTextContent('en-US');
    });

    it('maps `eu` to en-GB', () => {
      render(
        <SettingsProvider initial={{ dateFormat: 'eu' }}>
          <Harness />
        </SettingsProvider>,
      );
      expect(screen.getByTestId('locale')).toHaveTextContent('en-GB');
    });

    it('maps `auto` to undefined (OS-locale fallback)', () => {
      render(
        <SettingsProvider initial={{ dateFormat: 'auto' }}>
          <Harness />
        </SettingsProvider>,
      );
      expect(screen.getByTestId('locale')).toHaveTextContent('undef');
    });
  });

  describe('format hooks', () => {
    it('useFormatDate threads the current locale into the pure formatter', () => {
      // Spot-check the locale wiring. The exhaustive formatDate test
      // lives in utils/format; here we just confirm 'us' vs 'eu'
      // produce distinguishable outputs so a wiring regression is
      // caught.
      const { unmount: unmountUs } = render(
        <SettingsProvider initial={{ dateFormat: 'us' }}>
          <Harness />
        </SettingsProvider>,
      );
      const usText = screen.getByTestId('formatted').textContent ?? '';
      unmountUs();

      render(
        <SettingsProvider initial={{ dateFormat: 'eu' }}>
          <Harness />
        </SettingsProvider>,
      );
      const euText = screen.getByTestId('formatted').textContent ?? '';

      expect(usText).not.toBe('');
      expect(euText).not.toBe('');
      expect(usText).not.toBe(euText);
    });
  });

  describe('provider-less usage', () => {
    it('returns DEFAULTS and no-op setters when used outside a provider', async () => {
      // Unlike SelectionContext which throws, SettingsContext's
      // createContext default is a full value — tests and Storybook
      // can mount consumers without wrapping. Setters silently drop.
      const user = userEvent.setup();
      vi.stubGlobal('fetch', vi.fn());

      render(<Harness />);

      expect(screen.getByTestId('dateFormat')).toHaveTextContent('auto');
      expect(screen.getByTestId('themeMode')).toHaveTextContent('light');

      await user.click(screen.getByText('setFormatUS'));

      // No-op setter → state stays at defaults.
      expect(screen.getByTestId('dateFormat')).toHaveTextContent('auto');
    });
  });
});
