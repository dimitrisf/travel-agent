'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  formatBookingDateRange,
  formatFlightLabel,
  formatHotelLabel,
} from '@/utils/booking';
import type { SelectedFlight, SelectedHotel } from '@/context/SelectionContext';
import { useCurrentUser } from '@/lib/auth/client';
import { formatDate, formatDT } from '@/utils/format';

// User preferences surfaced by the header Settings menu — currently
// theme mode and date-format locale, extensible to further toggles.
// Dual storage: localStorage (per-browser) + a server-side user record
// (follows the user across devices). The hydrate effect reconciles
// the two per the sign-in / sign-out policy below; the setters do a
// write-through — localStorage synchronously (via the persist effect)
// and the server fire-and-forget (via PATCH /api/settings) when
// signed-in.
//
// Policy (see project_settings_server_persistence memory):
// - Anonymous: localStorage only.
// - Signed-in with server-saved prefs: server wins (download → write
//   through to localStorage).
// - Signed-in with no server-saved prefs: promote any localStorage
//   values to the server (PATCH), so a second device sees them.
// - Sign-out: localStorage copy preserved. Preferences aren't
//   sensitive data; forcing a theme reset on sign-out would be
//   jarring. Matches the cart-persistence pattern in SelectionContext
//   (Appendix D in that file).

export type DateFormat = 'auto' | 'us' | 'eu';
export type ThemeMode = 'light' | 'dark';

type SettingsState = {
  dateFormat: DateFormat;
  themeMode: ThemeMode;
};

type SettingsContextValue = SettingsState & {
  setDateFormat: (fmt: DateFormat) => void;
  setThemeMode: (mode: ThemeMode) => void;
};

// 'auto' as the default means rendered dates follow the user's OS
// locale (toLocaleDateString with undefined locale) — matches what
// native <input type="date"> pickers do and what most other sites
// show, so first-time visitors never need to find the toggle. The
// explicit 'us' / 'eu' overrides exist for the ~5-10% cases where
// the user's OS locale doesn't match their preference (expats,
// shared devices, deliberate choice).
const DEFAULTS: SettingsState = { dateFormat: 'auto', themeMode: 'light' };

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

// Shape returned by GET /api/settings — both fields nullable because
// a signed-in user may not have any prefs saved yet.
type ServerSettings = {
  dateFormat: string | null;
  themeMode: string | null;
};

// Read + normalize localStorage into our SettingsState shape, or
// return null if there's no stored value / it can't be parsed.
// Isolated so the hydrate effect reads it in one place.
function readLocalStorage(): SettingsState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<SettingsState>;
    return {
      dateFormat: parsed.dateFormat ?? DEFAULTS.dateFormat,
      themeMode: parsed.themeMode ?? DEFAULTS.themeMode,
    };
  } catch {
    return null;
  }
}

// Fire-and-forget PATCH /api/settings. Returns immediately; failures
// are swallowed (localStorage still holds the authoritative client-
// side copy, and the next successful write will reconcile). Guarded
// by a signed-in check at the call site.
function serverPersist(patch: Partial<SettingsState>): void {
  // void ensures the returned promise is ignored, making this a fire-and-forget call.
  void fetch('/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }).catch(() => {
    // Transient network / server error — the client's localStorage
    // still has the user's choice. Next successful write will catch
    // the server up.
  });
}

export function SettingsProvider({
  children,
  initial,
}: {
  children: ReactNode;
  // Test-only convenience: pin the initial state so tests can get
  // deterministic locale rendering without seeding localStorage.
  // Production never passes this — the hydrate effect handles the
  // real user preferences.
  initial?: Partial<SettingsState>;
}) {
  const [state, setState] = useState<SettingsState>({
    ...DEFAULTS,
    ...initial,
  });

  // Hydration guard: the first client render matches the server
  // (defaults), then the effect reads localStorage/server and
  // triggers a second render with the real preferences. Persisting
  // during the initial defaults render would overwrite stored prefs
  // with defaults on every mount — the flag suppresses that write.
  const [hydrated, setHydrated] = useState(false);

  // Current user — drives the hydrate effect's auth branch and the
  // write-path's "should we PATCH the server?" decision. Captured in
  // a ref for the setter path so the useCallback doesn't need to list
  // it as a dep (which would invalidate every setter identity on
  // auth change, cascading re-renders through every consumer).
  const currentUser = useCurrentUser();

  // Ref to hold the current user's ID for use in setter callbacks without
  // needing to list it as a dependency, avoiding unnecessary re-renders.
  // More specifically: Why a ref? The setters (setDateFormat, setThemeMode) are useCallback([]) with empty deps — if we listed currentUser?.id in deps, every auth transition would create new setter references → useMemo on the context value would re-run → every consumer re-renders. The ref sidesteps this. The setters read the current user ID from the ref at call time.
  const currentUserIdRef = useRef<string | null>(null);

  // Keep the current user's ID in a ref for use in setter callbacks. This effect updates the ref whenever the current user's ID changes, ensuring the setters always have the latest value without triggering re-renders.
  useEffect(() => {
    currentUserIdRef.current = currentUser?.id ?? null;
  }, [currentUser?.id]);

  // Hydrate on mount AND on sign-in/sign-out transitions (deps:
  // currentUser?.id). Policy:
  // - `initial` set: skip entirely (test ergonomics).
  // - Signed-in + server has prefs: server wins → write through to localStorage.
  // - Signed-in + server empty + localStorage has prefs: promote local → server.
  // - Signed-in + both empty: stay at DEFAULTS.
  // - Anonymous: read localStorage; preserve current state on sign-out
  //   because localStorage still has the signed-in prefs that got
  //   written through.
  useEffect(() => {
    // Skip hydration if initial is provided (test override).
    if (initial !== undefined) {
      setHydrated(true);
      return;
    }

    const localStored = readLocalStorage();
    const userId = currentUser?.id ?? null;

    // If there's no signed-in user, we will rely on localStorage for initial state.
    if (!userId) {
      // No signed-in user — treat as anonymous.

      if (localStored) setState(localStored);

      // hydration complete for anonymous user.
      setHydrated(true);
      return;
    }

    // Creates a signal + a way to trigger its abortion. controller.signal is a passive listener; controller.abort() is the trigger.
    // What AbortController does here
    // Short answer: It cancels an in-flight /api/settings request when the effect re-runs (user signs in or signs out again before the first fetch finishes) or when the component unmounts. Without it, a stale response could clobber state that already reflects a newer auth transition.
    // The two race conditions it protects against:
    // Race 1 — fast auth transition:
    // t=0ms    User signs in           → effect fires, fetch starts (A)
    // t=50ms   User signs out          → effect cleanup runs, re-runs with userId=null
    // t=100ms  Fetch A resolves        → tries to setState(signed-in-prefs)
    //                                ← but we're signed OUT now, so this is wrong state
    // Race 2 — component unmount:
    // User navigates away → component unmounts
    // Fetch still in flight → resolves after unmount
    // setState() on unmounted component → React warning, memory leak
    // Both are classic "async in useEffect" footguns. AbortController is the idiomatic fix.
    const controller = new AbortController();

    (async () => {
      try {
        // Hands the signal to fetch. If abort() is called while this fetch is pending, the fetch rejects with an AbortError instead of resolving.
        const res = await fetch(
          '/api/settings',
          // controller.signal is a passive listener
          { signal: controller.signal },
        );

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const server = (await res.json()) as ServerSettings;
        const serverHasPrefs =
          server.dateFormat !== null || server.themeMode !== null;

        if (serverHasPrefs) {
          // Server wins. Fall back to DEFAULTS field-by-field so a
          // half-populated row still gives us complete state.
          const next: SettingsState = {
            dateFormat:
              (server.dateFormat as DateFormat | null) ?? DEFAULTS.dateFormat,
            themeMode:
              (server.themeMode as ThemeMode | null) ?? DEFAULTS.themeMode,
          };
          setState(next);

          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch {}
        } else if (localStored) {
          // Server empty, local has values → promote local to server.
          // First-time-signed-in migration flow: the user set
          // preferences anonymously, now they get carried to a
          // server-backed identity so a second device sees them.
          setState(localStored);
          serverPersist(localStored);
        }
        // Else: both empty, state stays at DEFAULTS.
      } catch (err) {
        if (
          err instanceof Error &&
          (err.name === 'AbortError' || err.name === 'DOMException')
        ) {
          // Fetch was aborted — likely due to component unmount or user change. No need to update state.
          // More specifically, when the cleanup aborts the fetch, the Promise rejects — which lands in catch. We don't want to treat that as a real error (we'd fall through to the fallback to localStorage branch unnecessarily). So we identify the abort by error name and return silently.

          // (The DOMException check is belt-and-suspenders — some browsers throw a DOMException with name 'AbortError', others throw an Error with the same name. Catching both.)
          return;
        }
        // Network / server error → fallback to localStorage.
        if (localStored) setState(localStored);
      } finally {
        // Hydration complete regardless of success or failure, unless fetch was aborted.
        if (!controller.signal.aborted) setHydrated(true);
      }
    })();

    // This is the useEffect cleanup function. React runs it:
    // - When the effect re-runs (userId changed)
    // - When the component unmounts
    // Either way, we trigger the abort → the pending fetch rejects → catch block ignores it → nothing happens to state. New effect run (if any) starts fresh with a new controller.
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  // Persist state to localStorage whenever it changes, but only
  // after hydration — otherwise the initial defaults would overwrite
  // what's stored. Server-side writes are NOT done here; they're
  // triggered inline by the setters, so the hydrate flow doesn't
  // echo the just-fetched state back to the server.
  useEffect(() => {
    if (!hydrated) return;
    // Skip localStorage write if state hasn't changed since last hydration.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage quota, private window — the setting still applies
      // for this session via React state, we just can't persist.
    }
  }, [state, hydrated]);

  // Setters update React state (which triggers the localStorage
  // persist effect) and, if the user is signed in, fire-and-forget a
  // PATCH to the server. Server write happens here (not in the
  // persist effect) so hydration doesn't cause a redundant server
  // write that would echo the just-fetched value back.
  const setDateFormat = useCallback((dateFormat: DateFormat) => {
    setState((prev) => ({ ...prev, dateFormat }));
    if (currentUserIdRef.current) {
      serverPersist({ dateFormat });
    }
  }, []);

  const setThemeMode = useCallback((themeMode: ThemeMode) => {
    setState((prev) => ({ ...prev, themeMode }));
    if (currentUserIdRef.current) {
      serverPersist({ themeMode });
    }
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
// so callers don't repeat the mapping. 'auto' resolves to undefined
// so toLocaleDateString falls back to the user's OS/browser locale —
// matches what native <input type="date"> pickers display and what
// most other sites show.
export function useDateLocale(): string | undefined {
  const { dateFormat } = useSettings();
  if (dateFormat === 'us') return 'en-US';
  if (dateFormat === 'eu') return 'en-GB';
  return undefined;
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
