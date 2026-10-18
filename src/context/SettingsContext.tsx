'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  formatBookingDateRange,
  formatFlightLabel,
  formatHotelLabel,
} from '@/utils/booking';
import type { SelectedFlight, SelectedHotel } from '@/context/SelectionContext';
import { formatDate, formatDT } from '@/utils/format';

// User preferences surfaced by the header Settings menu — currently
// theme mode and date-format locale, extensible to further toggles.
// Persisted in localStorage so the choice survives sessions on the
// same browser; server-side persistence against the user record is
// deliberately deferred to a follow-up PR (requires a user-table
// migration + API endpoint).

export type DateFormat = 'us' | 'eu';
export type ThemeMode = 'light' | 'dark';

type SettingsState = {
  dateFormat: DateFormat;
  themeMode: ThemeMode;
};

type SettingsContextValue = SettingsState & {
  setDateFormat: (fmt: DateFormat) => void;
  setThemeMode: (mode: ThemeMode) => void;
};

// EU as the default matches the day-before-month ordering most
// non-US system locales already produce — makes the first paint
// before localStorage hydration a no-op for most visitors.
const DEFAULTS: SettingsState = { dateFormat: 'eu', themeMode: 'light' };

// Bumped alongside any breaking change to the stored shape, so an
// old-shape entry doesn't rehydrate as a type mismatch.
const STORAGE_KEY = 'app:settings:v1';

// Non-null default context value — hooks called outside a provider
// (unit tests, Storybook, deeply-stubbed renders) return the defaults
// and silently drop setter calls, keeping tests small while
// production always has the real provider wrapped in app/layout.
const SettingsContext = createContext<SettingsContextValue>({
  ...DEFAULTS,
  setDateFormat: () => {},
  setThemeMode: () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SettingsState>(DEFAULTS);
  // Hydration guard: the first client render matches the server
  // (defaults), then the effect reads localStorage and triggers a
  // second render with the stored preferences. Persisting during
  // the initial defaults render would overwrite stored prefs with
  // defaults on every mount — the flag suppresses that write.
  const [hydrated, setHydrated] = useState(false);

  // Effect to read stored settings from localStorage on mount and
  // mark the context as hydrated afterward.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<SettingsState>;
        setState({
          dateFormat: parsed.dateFormat ?? DEFAULTS.dateFormat,
          themeMode: parsed.themeMode ?? DEFAULTS.themeMode,
        });
      }
    } catch {
      // Private window, blocked site data, or stale JSON — fall
      // through to defaults, no reason to log.
    }
    setHydrated(true);
  }, []);

  // Effect to persist settings to localStorage whenever they change,
  // but only after the initial hydration to avoid overwriting stored
  // preferences with defaults.
  useEffect(() => {
    if (!hydrated) return;

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage quota, private window — the setting still applies
      // for this session via React state, we just can't persist.
    }
  }, [state, hydrated]);

  // Setter for the date format preference. Updates React state and
  // triggers the persistence effect.
  const setDateFormat = useCallback((dateFormat: DateFormat) => {
    setState((prev) => ({ ...prev, dateFormat }));
  }, []);

  // Setter for the theme mode preference. Updates React state and
  // triggers the persistence effect.
  // Memoize the context value to avoid unnecessary re-renders of consumers.
  const setThemeMode = useCallback((themeMode: ThemeMode) => {
    setState((prev) => ({ ...prev, themeMode }));
  }, []);

  // Memoize the context value to avoid unnecessary re-renders of consumers.
  const value = useMemo<SettingsContextValue>(
    () => ({ ...state, setDateFormat, setThemeMode }),
    [state, setDateFormat, setThemeMode],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext);
}

// Intl locale string for the current date-format setting. Isolated
// so callers don't repeat the `us → en-US`/`eu → en-GB` mapping.
export function useDateLocale(): string {
  const { dateFormat } = useSettings();
  return dateFormat === 'us' ? 'en-US' : 'en-GB';
}

// Date-formatter hooks: each wraps the corresponding pure helper in
// `@/utils/format` or `@/utils/booking` with the current locale, so
// client components get a bound formatter and don't have to thread
// the locale through props. useCallback keeps the returned function
// identity-stable across renders when the locale hasn't changed —
// important for anything that memoizes on the formatter reference.

export function useFormatDate(): (iso: string) => string {
  const locale = useDateLocale();
  return useCallback((iso: string) => formatDate(iso, locale), [locale]);
}

// Hook for a memoized date-time formatter bound to the current locale.
// iso is an ISO 8601 date-time string, i.e., "YYYY-MM-DDTHH:mm:ssZ".
export function useFormatDT(): (iso: string) => string {
  const locale = useDateLocale();

  // Return a memoized date-time formatter function bound to the current locale.
  return useCallback((iso: string) => formatDT(iso, locale), [locale]);
}

export function useFormatBookingDateRange(): (
  start: string,
  end: string,
) => string {
  const locale = useDateLocale();
  return useCallback(
    (start: string, end: string) => formatBookingDateRange(start, end, locale),
    [locale],
  );
}

export function useFormatFlightLabel(): (f: SelectedFlight) => string {
  const locale = useDateLocale();
  return useCallback(
    (f: SelectedFlight) => formatFlightLabel(f, locale),
    [locale],
  );
}

export function useFormatHotelLabel(): (h: SelectedHotel) => string {
  const locale = useDateLocale();
  return useCallback(
    (h: SelectedHotel) => formatHotelLabel(h, locale),
    [locale],
  );
}
