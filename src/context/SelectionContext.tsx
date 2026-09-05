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
import type { CabinClass } from '@/lib/pricing';

// Cross-page booking cart for /explorer/*. Users pick flights on the
// flights page and hotels on the hotels page; the selection persists
// across navigation and lands on /explorer/booking as the propose-
// booking payload.
//
// Slice-1 constraint: at most ONE flight and ONE hotel. Clicking a
// second row REPLACES the current slot; clicking the currently-
// selected row CLEARS it (toggle). Multi-item is a future slice.
//
// Payload shape is deliberately close to what propose_booking accepts —
// ids + query-time context (cabin_class, seats for flights;
// checkin/checkout/guests/rooms for hotels) — so the booking page
// builds its request body without re-fetching or re-deriving. The
// display fields (label, prices) are captured at click time so the
// cart survives independently of the response panel's rehydration.

export type SelectedFlight = {
  flight_instance_id: number;
  cabin_class: CabinClass;
  seats: number;
  // priceEUR is per-seat; totalEUR = priceEUR × seats snapshotted at
  // click time. Captured together so the cart doesn't have to know how
  // to multiply — and so a later change to seats (via a new search)
  // doesn't retroactively rewrite this selection's total.
  priceEUR: number;
  totalEUR: number;
  label: string;
};

export type SelectedHotel = {
  room_type_id: number;
  checkin: string;
  checkout: string;
  guests: number;
  rooms: number;
  nights: number;
  pricePerNightEUR: number;
  totalEUR: number;
  label: string;
};

type SelectionState = {
  flight: SelectedFlight | null;
  hotel: SelectedHotel | null;
};

type SelectionContextValue = SelectionState & {
  // Set to the incoming payload if it differs from the current one, or
  // clear to null. Callers use the row-click convention: pass the
  // payload, and if it matches the current selection — same row id AND
  // same search parameters (cabin+seats for flights, dates+guests+
  // rooms for hotels) — the store clears, supporting the "click again
  // to deselect" gesture without leaking that logic into rows.
  toggleFlight: (candidate: SelectedFlight) => void;
  toggleHotel: (candidate: SelectedHotel) => void;
  clearFlight: () => void;
  clearHotel: () => void;
  clearAll: () => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

const EMPTY: SelectionState = { flight: null, hotel: null };
// Key used to persist the selection state in sessionStorage.
const STORAGE_KEY = 'explorer:selection:v1';

// A row is "the same selection" when both the row id AND the search
// parameters it was priced under match. Two searches for the same
// flight_instance_id at different cabin classes yield different total
// prices and are distinct selections — toggling one must not clear
// the other. Same story for a hotel searched at different guest
// counts (weekend surcharges scale by occupancy).
function flightsMatch(a: SelectedFlight, b: SelectedFlight): boolean {
  return (
    a.flight_instance_id === b.flight_instance_id &&
    a.cabin_class === b.cabin_class &&
    a.seats === b.seats
  );
}

function hotelsMatch(a: SelectedHotel, b: SelectedHotel): boolean {
  return (
    a.room_type_id === b.room_type_id &&
    a.checkin === b.checkin &&
    a.checkout === b.checkout &&
    a.guests === b.guests &&
    a.rooms === b.rooms
  );
}

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SelectionState>(EMPTY);

  // Hydrate from sessionStorage after mount. Same two-render dance as
  // usePersistedState: initial paint uses EMPTY (safe for SSR since
  // sessionStorage is a browser API), then effect reads storage and
  // schedules a re-render with the persisted value.
  //
  // See the appendix at the bottom of this file for a detailed
  // walkthrough of how these two effects and the `hydrated` ref
  // coordinate, plus the reasoning behind reading storage in an
  // effect rather than during render.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        setState(JSON.parse(raw) as SelectionState);
      }
    } catch {
      /* corrupt entry — keep EMPTY */
    }
  }, []);

  // Persist on every real change. Ref-latched so we can skip the very
  // first commit (which just paints EMPTY before hydration reads
  // storage) — otherwise we'd overwrite whatever the hydrate effect is
  // about to read.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota / private mode — silently skip */
    }
  }, [state]);

  // Why useCallback / useMemo below?
  //
  // useCallback here is defensive, not strictly required in this
  // codebase. useCallback gives you a stable function reference across
  // renders. That matters in two scenarios:
  //
  // 1. A consumer puts the function in a hook dependency array
  //    (useEffect(fn, [selection.toggleFlight]), useMemo(...),
  //    memoized-child props). Without useCallback, toggleFlight is a
  //    fresh function on every provider render, which cascades into
  //    every dependent hook firing again. Today, our only consumers
  //    (FlightRow, HotelCard, SelectionBar) just call it from onClick,
  //    so no dep-array issue happens.
  //
  // 2. Preventing consumer re-renders when the provider re-renders for
  //    reasons other than its own state. The provider's `value` is
  //    memoized on [state, toggleFlight, …]. If toggleFlight had a new
  //    reference each render, the useMemo would produce a new `value`
  //    every render, and every useSelection() consumer would re-render
  //    even when the cart is unchanged. useCallback keeps `value`
  //    reference-stable so React skips consumers. Concretely bites when
  //    a parent above the provider re-renders (state change somewhere
  //    higher in /explorer/layout.tsx or above).
  //
  // For our current tree, the provider mounts under ExplorerLayout,
  // which is a stable server layout — it basically never re-renders
  // from above. So today useCallback is mostly ceremony. It matters
  // more once someone adds a hook consumer that reads toggleFlight in
  // a dep array, or once the provider's parent starts changing.
  //
  // Kept because:
  // - Zero cost in practice (React does the memo bookkeeping either
  //   way; the function body is tiny).
  // - Consistent with ShareContext (the app's other context does the
  //   same for setShared).
  // - Future-proof: someone adding a new consumer that memoizes
  //   shouldn't have to come back and rewrite the hook.
  const toggleFlight = useCallback((candidate: SelectedFlight) => {
    setState((prev) => ({
      ...prev,
      flight:
        prev.flight && flightsMatch(prev.flight, candidate) ? null : candidate,
    }));
  }, []);

  const toggleHotel = useCallback((candidate: SelectedHotel) => {
    setState((prev) => ({
      ...prev,
      hotel:
        prev.hotel && hotelsMatch(prev.hotel, candidate) ? null : candidate,
    }));
  }, []);

  const clearFlight = useCallback(() => {
    setState((prev) => ({ ...prev, flight: null }));
  }, []);

  const clearHotel = useCallback(() => {
    setState((prev) => ({ ...prev, hotel: null }));
  }, []);

  const clearAll = useCallback(() => {
    setState(EMPTY);
  }, []);

  // Why useMemo for the value?
  //
  // Same idea as useCallback, one level up — they're a matched pair.
  //
  // Context.Provider triggers a re-render in every consumer whenever
  // its `value` prop is a different reference (React uses Object.is
  // for that check — not shallow comparison of contents). Without
  // useMemo:
  //
  //   const value = { ...state, toggleFlight, toggleHotel, ... };
  //
  // Every render of SelectionProvider builds a fresh object literal,
  // so Object.is(oldValue, newValue) is always false, so React
  // notifies every useSelection() consumer even when nothing they
  // care about changed. With useMemo, the object only rebuilds when
  // one of the deps (state, the toggles, the clears) actually
  // changes reference — which, combined with the useCallbacks,
  // means only on real state changes.
  //
  // Why useCallback and useMemo here are a matched pair — they only
  // pay off together:
  //
  // - Keep useMemo, drop the useCallbacks → every toggleFlight /
  //   clearAll is a new reference each render → useMemo's dep list
  //   churns → new value every render → consumers re-render every
  //   time. useMemo becomes ceremony that doesn't actually memoize
  //   anything.
  //
  // - Keep useCallbacks, drop the useMemo → the functions are stable
  //   but the returned `value` object is a new literal each render →
  //   consumers still re-render every time. useCallback becomes
  //   ceremony that doesn't reach Context.Provider.
  //
  // - Both together → value is reference-stable across renders where
  //   state didn't change → consumers only re-render when the cart
  //   actually changes.
  //
  // Same honest verdict as the useCallback block above: in our
  // current tree the provider is mounted under a stable server
  // layout and re-renders almost only on its own state changes, so
  // the wasted-render count without either optimization is tiny.
  // It's the "canonical shape" for a shared-state context — cheap
  // ceremony, matches ShareContext's pattern, and future-proofs
  // against someone adding a hook consumer or a re-rendering
  // ancestor that would otherwise cause cascading re-renders.
  const value = useMemo<SelectionContextValue>(
    () => ({
      ...state,
      toggleFlight,
      toggleHotel,
      clearFlight,
      clearHotel,
      clearAll,
    }),
    [state, toggleFlight, toggleHotel, clearFlight, clearHotel, clearAll],
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) {
    throw new Error('useSelection must be used inside <SelectionProvider>');
  }
  return ctx;
}

// Predicate helpers used by rows to decide whether they're the
// currently-selected one — cheap enough to inline, but naming them
// keeps the row code readable.
export function isSelectedFlight(
  ctx: SelectionContextValue,
  candidate: SelectedFlight,
): boolean {
  return ctx.flight !== null && flightsMatch(ctx.flight, candidate);
}

export function isSelectedHotel(
  ctx: SelectionContextValue,
  candidate: SelectedHotel,
): boolean {
  return ctx.hotel !== null && hotelsMatch(ctx.hotel, candidate);
}

// ============================================================
// APPENDIX
// ============================================================
//
// Preserved long-form walkthroughs for the two subtle bits of this
// file. Kept here rather than inline so the provider body stays
// scannable, but preserved in-file so future-you can find them
// without hunting through git history.
//
//
// ------------------------------------------------------------
// A. Interplay between `state`, the two useEffects, and the
//    `hydrated` ref
// ------------------------------------------------------------
//
// Three moving parts, one goal: state should mirror sessionStorage
// in both directions, without the initial "empty" render clobbering
// what's already in storage.
//
// The parts
//
//   - state (useState, initial EMPTY)
//       The truth for what the UI renders. Updated by setState
//       (hydrate effect + user actions).
//
//   - Hydrate effect (deps [])
//       Read storage → push into state. Fires once, after first
//       commit.
//
//   - Persist effect (deps [state])
//       Write state → storage. Fires after every commit where
//       `state` reference changed.
//
//   - `hydrated` ref (initial false)
//       Latch that tells the persist effect "skip the first tick."
//       Set to true on its first invocation.
//
// The ref matters because both effects are scheduled to run *after*
// the same first commit — so the persist effect would otherwise
// fire before the hydrate effect has had a chance to redirect us
// onto the second render.
//
//
// Case A — Mount, storage empty (fresh session)
//
//   Render 1: state = EMPTY. DOM commits an empty tree (bar hidden).
//   Effects run, in declaration order:
//     - Hydrate: sessionStorage.getItem(STORAGE_KEY) → null. No
//       setState. Done forever (empty deps).
//     - Persist: hydrated.current === false → set it to true,
//       return. NO WRITE.
//
//   That's it. Storage is untouched, DOM shows empty. If we HAD
//   let the persist effect run naively, it would have written EMPTY
//   into storage on mount — harmless here, but the same behavior in
//   case B would be a real bug (see next).
//
//
// Case B — Mount, storage has a persisted cart
//
//   Render 1: state = EMPTY (React can't read storage synchronously
//     without breaking SSR — see section B below). DOM commits
//     empty tree — a brief flash.
//   Effects run:
//     - Hydrate: reads storage → { flight: ..., hotel: ... } →
//       setState(persisted). This schedules Render 2.
//     - Persist: hydrated.current === false → latch it to true,
//       return. NO WRITE.
//
//   This is the reason the ref exists. Without it, this line would
//   run with the state closure from render 1 (which is EMPTY) and
//   write EMPTY back over the persisted value we just successfully
//   read. setState from the hydrate line is asynchronous — the
//   persist effect DOES NOT see the new state on this commit; it
//   sees the state from the render it was scheduled in.
//
//   Render 2 (triggered by hydrate's setState):
//     state = persisted. DOM commits populated tree (bar appears
//     with selections).
//   Effects re-check:
//     - Hydrate: doesn't re-fire — empty deps, already ran.
//     - Persist: hydrated.current === true. state reference
//       changed. Writes `persisted` back to storage. Redundant
//       no-op write (same bytes), but harmless.
//
//   End state: two paints (empty flash, then hydrated), storage
//   untouched, cart on screen.
//
//
// Case C — User clicks Add on a flight row
//
//   FlightRow calls toggleFlight(payload) → setState((prev) =>
//     ({ ...prev, flight: candidate })).
//   Render N: state = new selection. DOM commits — button flips to
//     "Selected", bar reflects the pick.
//   Effects re-check:
//     - Hydrate: doesn't fire.
//     - Persist: hydrated.current === true. state changed.
//       WRITES NEW STATE TO STORAGE. ✔
//
//   Every subsequent user action follows this path — one commit,
//   one write.
//
//
// Case D — Nav between /explorer pages
//
//   ExplorerLayout (which mounts the provider) is stable across
//   /explorer/flights ↔ /explorer/hotels. The provider doesn't
//   unmount; state and hydrated are preserved in memory. No
//   hydrate roundtrip. Storage-sync continues via the persist
//   effect on any new action.
//
//
// Case E — Nav away and come back
//
//   Nav to /: ExplorerLayout unmounts. Provider is destroyed.
//   State gone from memory. Storage still holds the last persist.
//
//   Nav back to /explorer/*: fresh mount → runs Case B → state
//   restored from storage → user sees cart resume.
//
//
// Why the ref instead of some other trick
//
// Three alternatives considered before settling on the ref:
//
//   1. Lazy useState initializer that reads storage:
//        useState(() => {
//          const raw = sessionStorage.getItem(...);
//          return raw ? JSON.parse(raw) : EMPTY;
//        });
//      Reads storage during render, no async gap. But it breaks
//      SSR: on the server there's no sessionStorage, so
//      server-rendered HTML has EMPTY; client rehydration sees
//      persisted → different DOM → React logs a hydration mismatch
//      and remounts. The two-render dance avoids this at the cost
//      of one flash paint.
//
//   2. Skip the persist write when state === EMPTY:
//      Fragile — EMPTY is a legitimate user state (they clicked
//      Clear). A user who cleared their cart and refreshed would
//      find it un-cleared. Semantic conflation.
//
//   3. A boolean state var instead of the ref:
//      Setting it would trigger an extra render. Ref is free
//      (writes don't cause renders) and preserves the semantics.
//
// The ref pattern says exactly what we mean: "the persist side of
// the loop shouldn't do anything until we've had one commit for
// the hydrate side to run first."
//
//
// The subtle invariant
//
// The pair of effects, plus the ref, guarantees:
//
//   The very first persist attempt is always a no-op, regardless
//   of what state contains. So the hydrate → setState → persist
//   cycle either does the right thing (write the persisted value
//   back, harmless no-op) or does nothing (state was untouched,
//   hydrate found nothing). Either way, storage is NEVER
//   overwritten with a value that isn't the direct result of a
//   real action or a successful hydration.
//
//
// ------------------------------------------------------------
// B. What "React can't read storage synchronously without
//    breaking SSR" actually means
// ------------------------------------------------------------
//
// Two things stacked: sessionStorage is browser-only, and
// SelectionProvider runs on the SERVER first (even though it has
// 'use client') as part of Next.js's SSR pass.
//
// What "SSR runs your component" actually means
//
// 'use client' marks a component as client-interactive — it
// hydrates and re-renders on the client. But Next.js App Router
// ALSO renders it once on the server as part of building the
// initial HTML response. That's how the first paint is
// server-rendered instead of a spinner.
//
// So SelectionProvider runs its render body twice for the very
// first pageview:
//
//   1. On the server to produce HTML.
//   2. On the client during hydration, to attach event handlers
//      and prepare for updates.
//
// Both invocations must produce the same output — that's the
// contract React relies on. If they differ, React logs a hydration
// mismatch and (in prod) may silently swap the mismatched subtree
// in a way that discards event handlers.
//
//
// Now the problem with a lazy useState initializer
//
//   const [state, setState] = useState(() => {
//     const raw = sessionStorage.getItem(STORAGE_KEY);
//     return raw ? JSON.parse(raw) : EMPTY;
//   });
//
// The initializer runs every time the component is set up —
// including on the server.
//
//   Server: there is no sessionStorage. It's a property of the
//   browser window object. Node.js doesn't have it. Calling
//   sessionStorage.getItem(...) throws
//   `ReferenceError: sessionStorage is not defined` — the whole
//   server render crashes. The Next.js response becomes a 500.
//
// You could guard it:
//
//   useState(() => {
//     if (typeof window === 'undefined') return EMPTY;
//     const raw = sessionStorage.getItem(STORAGE_KEY);
//     return raw ? JSON.parse(raw) : EMPTY;
//   });
//
// That doesn't crash, but it introduces the OTHER half of the
// problem:
//
//   Server render: window undefined → initializer returns EMPTY →
//     HTML is generated with an empty cart bar (i.e. nothing).
//   Client hydration: window exists,
//     sessionStorage.getItem(...) returns the persisted cart →
//     initializer returns persisted → React tries to reconcile
//     against the server HTML → CONTENT MISMATCH.
//
// React's hydration reconciler expects the tree it computes on the
// client to exactly match the DOM the server sent. When they
// differ:
//
//   - In dev: a big red console error `Hydration failed because
//     the initial UI does not match what was rendered on the
//     server.`
//   - In prod (React 18/19): React discards its hydration attempt
//     for the mismatched subtree and re-renders it client-side.
//     Any state or event handlers it had set up mid-hydration go
//     with it. It usually "works" but you've broken the
//     fast-hydration path.
//
//
// Why the two-render dance sidesteps both
//
// By initializing state to EMPTY unconditionally and only reading
// storage in a useEffect:
//
//   - Server and initial client render both compute state = EMPTY
//     → identical HTML → no hydration mismatch. React can attach
//     handlers cleanly.
//   - AFTER first commit, useEffect runs (client-only — effects
//     don't fire during SSR at all), reads storage, and calls
//     setState. A second render happens on the client only.
//     Nothing to reconcile against server HTML at that point;
//     it's a normal state update.
//
// The "brief flash of empty" you see is the price you pay for
// keeping the server and client agreeing on that first render.
//
//
// Small footnote on the word "synchronously"
//
// A bit sloppy — sessionStorage.getItem IS synchronous (it's a
// plain function that returns immediately). What was meant was
// "during render, without waiting for an effect." The problem
// isn't the operation being slow; the problem is WHERE you're
// calling it. Reading storage during render happens on both the
// server and the client. Reading it in an effect happens only on
// the client, which is exactly where storage exists.
//
//
// ------------------------------------------------------------
// C. Why sessionStorage and not localStorage?
// ------------------------------------------------------------
//
// Four real reasons, in rough order of importance for this
// project.
//
//
// 1. The cart is in-progress work, and its inputs go stale.
//
// Flights and hotels in this demo come from a rolling seeded
// window (14 days for flights, 21 days for hotels). A selection
// made two days ago might reference a flight_instance_id that's
// already outside today's window, or a hotel row whose weekend
// surcharge date has shifted. localStorage would proudly
// resurrect that stale cart on the next visit and the "Go to
// booking" step would then fail obscurely. sessionStorage treats
// the cart the way it actually behaves: valid for the duration
// of THIS browsing session, gone when the tab closes.
//
//
// 2. Per-tab isolation is a genuine feature, not a bug.
//
// A reviewer comparing options might open two Explorer tabs side
// by side — "what if I picked the 09:40 flight vs. the 12:30?"
// With localStorage, both tabs share one cart: every click in
// tab A silently clobbers tab B. With sessionStorage, each tab
// has its own cart. That matches the real user's mental model
// of two independent explorations.
//
//
// 3. Consistency with the rest of the app.
//
// Every other persisted piece of Explorer state — form fields,
// response state, sort specs, sticky search context — is stored
// via usePersistedState, which uses sessionStorage. Split-brain
// persistence (some things gone after tab close, others
// stubbornly hanging around) would be confusing. Whichever
// choice we make, the whole /explorer/* surface should agree.
//
//
// 4. Cleaner failure mode for a shared/demo machine.
//
// Explorer is likely to be opened on demo machines, laptops
// passed around, review sessions where someone else picks up.
// sessionStorage guarantees the previous person's cart isn't
// sitting there when the next person opens a tab. localStorage
// would leak state across users of the same machine.
//
//
// The trade-off you give up is real: a user who deliberately
// abandons a tab and comes back tomorrow expecting their picks
// to still be there won't find them. For an actual booking
// product with slow deliberate purchase decisions, localStorage
// (or better, a server-side draft persisted to their account)
// would win. For an audit tool where the workflow is
// search → pick → book → done, all inside one sitting,
// sessionStorage is the right fit.
