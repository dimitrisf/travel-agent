'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// useState + sessionStorage. Session-scoped so a fresh tab starts clean
// but Explorer↔Assistant toggles preserve every form field and last
// response. Optional `filter` skips persisting values that shouldn't
// survive a round-trip — e.g. a { kind: 'loading' } ResponseState that
// would restore into a stuck spinner.
//
// Persistence hangs off setValue (caller-initiated updates only), never
// off a useEffect that watches `value`. That avoids a race on mount where
// the persist effect fires with the stale initial value in its closure
// and overwrites what the hydrate effect just read.

export function usePersistedState<T>(
  // sessionStorage key. Must be unique across the app, e.g.
  // 'explorer:weather:forecast:state'.
  key: string,
  // initial value is used for the first render, then replaced by the
  // hydrate effect. It must be serializable to JSON.
  initial: T,
  // optional filter function. If provided, only values for which
  // filter(value) returns true will be persisted. This is useful for
  // skipping transient states like { kind: 'loading' } in ResponseState.
  filter?: (value: T) => boolean,
): [T, (next: T) => void] {
  const [value, setValueInternal] = useState<T>(initial);

  // Let me make it fully concrete with a trace of what changes between two
  // renders.
  //
  // The scenario: imagine someone calls the hook with an inline arrow (the
  // common React idiom):
  //
  //   function ForecastPanel() {
  //     const [days, setDays] = usePersistedState(...);
  //
  //     const [state, setState] = usePersistedState<ResponseState<ForecastResponse>>(
  //       'explorer:weather:forecast:state',
  //       { kind: 'idle' },
  //       (s) => s.kind !== 'loading',   // ← inline arrow
  //     );
  //     // ...
  //   }
  //
  // Each time ForecastPanel re-renders (say, because the user typed in the
  // Days input), JavaScript evaluates that arrow *fresh*. So filter is a
  // different function object every render:
  //
  //   Render 1: filter = fn_A       (memory address 0x1000)
  //   Render 2: filter = fn_B       (memory address 0x2000)  ← same source, different object
  //   Render 3: filter = fn_C       (memory address 0x3000)
  //
  // fn_A, fn_B, fn_C all *do* the same thing (s => s.kind !== 'loading')
  // but they're not === to each other. That's the setup.
  //
  // Without the ref — filter is a useCallback dep:
  //
  //   const setValue = useCallback((next: T) => {
  //     ...
  //     if (filter && !filter(next)) return;
  //     ...
  //   }, [key, filter]);
  //
  //   Render 1: filter = fn_A → useCallback creates setValue_1  (memory address 0xAAA)
  //   Render 2: filter = fn_B → filter changed → useCallback creates setValue_2 (memory address 0xBBB)
  //   Render 3: filter = fn_C → filter changed → useCallback creates setValue_3 (memory address 0xCCC)
  //
  // Every render of ForecastPanel gets back a **different setState**. That
  // breaks two things concretely:
  //
  // - React.memo — if ForecastPanel ever passed setState down to a
  //   memoized child, the child re-renders every time even though its
  //   "props" didn't semantically change.
  // - useEffect deps — a downstream effect like useEffect(fn, [setState])
  //   fires on every render.
  //
  // With the ref — filter lives outside useCallback's dep list:
  //
  //   const filterRef = useRef(filter);
  //   filterRef.current = filter;
  //
  //   const setValue = useCallback((next: T) => {
  //     ...
  //     if (filterRef.current && !filterRef.current(next)) return;
  //     ...
  //   }, [key]);   // filter no longer a dep
  //
  //   Render 1: filterRef.current = fn_A → useCallback creates setValue_1 (0xAAA)
  //   Render 2: filterRef.current = fn_B → deps unchanged → returns same setValue_1 (0xAAA)
  //   Render 3: filterRef.current = fn_C → deps unchanged → returns same setValue_1 (0xAAA)
  //
  // setState is now stable across renders. Memo children stay memoized;
  // effect dep lists don't churn.
  //
  // And notice: the *behavior* is still correct — when setValue_1 runs,
  // it reads filterRef.current, which was just updated during the current
  // render. So it always uses the latest filter, even though the
  // function-object it lives in is the old one.
  //
  // Concrete takeaway
  //
  // The line filterRef.current = filter running on every render is doing a
  // small trick: it stores the fresh filter somewhere the memoized
  // setValue can look it up **without** making that filter a dep. You get
  // the stability of a memoized function (reference-equal across renders)
  // plus the freshness of always-latest closure (the ref is written every
  // render). It's a standard React pattern people call the "latest ref"
  // idiom — you'll see it in libraries like Downshift, react-use, and
  // TanStack Query for exactly the same reason: don't let inline callbacks
  // poison memoization.
  //
  // Today usePersistedState is called with notLoading from module scope,
  // which is already stable — so the current call sites wouldn't hit the
  // churn. The ref is defensive: the moment someone writes (s) => ...
  // inline, the hook still behaves.
  const filterRef = useRef(filter);
  filterRef.current = filter;

  // That line compresses two React mechanics. Let me unpack each.
  //
  // Part 1 — why hydration takes two renders
  //
  // React's mount cycle has three phases, in this strict order:
  //
  // 1. Render — React calls your component function to produce the
  //    virtual DOM. Nothing painted yet.
  // 2. Commit — React applies that tree to the real DOM. Browser paints.
  // 3. Effects — every useEffect registered in that commit runs.
  //
  // Effects run *after* paint. They cannot change what was just painted
  // — they can only schedule a *new* render for the future.
  //
  // So on mount, useState<T>(initial) gives value = initial. Render uses
  // that, commit paints it. Then the hydrate effect fires — reads storage
  // — calls setValueInternal('Berlin'). That's a state update, which
  // schedules a second render. The second render sees value = 'Berlin'
  // and repaints.
  //
  //   frame 1:  render(Athens) → commit → paint(Athens) → effect: setValueInternal('Berlin')
  //   frame 2:  render(Berlin) → commit → paint(Berlin)
  //
  // In wall-clock time this is usually a single animation frame —
  // imperceptible for something small like a city name — but the
  // sequence really is two paints. If storage was empty, only frame 1
  // happens (the effect finds nothing, doesn't call setValue, no
  // re-render is scheduled).
  //
  // If you wanted to skip frame 1 and paint 'Berlin' immediately, you'd
  // have to read storage synchronously during the render function, e.g.
  // useState(() => sessionStorage.getItem(...) ?? initial). That's what
  // breaks SSR, which is Part 2.
  //
  // Part 2 — why SSR touches neither storage nor throws
  //
  // Next.js App Router renders every component on the server too, even
  // 'use client' ones — that's how it ships fully-formed HTML for the
  // first paint. But server-side rendering only runs the Render phase.
  // Commit and Effects are browser concepts — they don't exist on the
  // server.
  //
  // Concretely, during SSR of a component using usePersistedState:
  //
  // - useState<T>(initial) runs, value = initial. Fine, pure computation.
  // - useEffect(...) is registered but **never invoked**. Its body —
  //   including sessionStorage.getItem(key) — doesn't execute.
  // - Server outputs HTML with the initial value baked in.
  //
  // If the effect body ran on the server, we'd crash: sessionStorage is
  // a browser global; on Node it's undefined, and undefined.getItem(...)
  // throws. The reason this hook can reference sessionStorage
  // unconditionally without guarding for typeof window is that every
  // such reference is inside useEffect or inside setValue (only ever
  // called from event handlers, which are also client-only). React
  // guarantees neither will fire during SSR.
  //
  // Then in the browser:
  //
  // 1. Browser paints server HTML immediately → user sees 'Athens'.
  // 2. React hydrates: re-runs the render function on the client,
  //    matches it against the existing DOM. Still 'Athens' — hydration
  //    succeeds.
  // 3. Now that we're client-side, effects run. Hydrate effect reads
  //    'Berlin' → setValueInternal.
  // 4. Second render → paints 'Berlin'.
  //
  // So Part 1's two-render dance and Part 2's SSR-safety are the same
  // phenomenon: the effect runs strictly after the first client-side
  // commit, which is exactly when storage becomes both *available*
  // (browser API) and *safe to read* (no impact on SSR output). That's
  // the property the comment's second half is claiming — server touches
  // neither sessionStorage.getItem (would throw) nor
  // sessionStorage.setItem (would also throw, and would corrupt the
  // "storage is a client-only concept" model).
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(key);

      if (stored !== null) {
        setValueInternal(JSON.parse(stored) as T);
      }
    } catch {
      /* corrupt entry — keep initial */
    }
  }, [key]);

  const setValue = useCallback(
    (next: T) => {
      setValueInternal(next);

      if (filterRef.current && !filterRef.current(next)) return;

      try {
        sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* quota / private mode — silently skip */
      }
    },
    [key],
  );

  return [value, setValue];
}
