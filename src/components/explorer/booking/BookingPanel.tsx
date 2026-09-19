'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import SendIcon from '@mui/icons-material/Send';
import { BookingCard } from '@/components/BookingCard';
import { PageHeader } from '@/components/explorer/PageHeader';
import { PanelHeader } from '@/components/explorer/PanelHeader';
import { useSelection } from '@/context/SelectionContext';
import {
  buildProposePayload,
  cartHasItems,
} from '@/lib/explorer/buildProposePayload';
import { usePersistedState } from '@/lib/explorer/usePersistedState';
import { useCurrentUser } from '@/lib/auth/client';
import { confirmBooking } from '@/lib/booking/bookingActions';
import type { BookingLike, Cart } from '@/types/booking';
import { CartSummary } from './CartSummary';

// sessionStorage key for the last proposed booking. Session-scoped
// so a fresh tab starts clean, but survives /explorer/* navigation
// so the user can leave the booking page and come back to the same
// proposal instead of the empty state. Bumped alongside any breaking
// change to BookingLike so a stale entry doesn't rehydrate as
// garbage. v1 = initial persistence.
const PROPOSED_BOOKING_STORAGE_KEY = 'explorer:proposedBooking:v1';

// Explorer's booking terminus — the panel the SelectionBar's "Go to
// booking" button lands on. Reads the cart, POSTs it to
// /api/booking/propose, and hands the returned booking to the
// existing <BookingCard> which owns Confirm / Cancel.
//
// The cart is cleared on successful propose so the SelectionBar
// disappears and the freshly-proposed booking is the only thing the
// user sees interact with. A retry after a network error gets a fresh
// idempotency_key on each click — good enough for a demo; a
// production version would hash the cart for true dedupe.
//
// Extracted from app/explorer/booking/page.tsx so the vitest config's
// `src/**/*.test.{ts,tsx}` include picks it up without extending to
// the app router tree.

export function BookingPanel() {
  const selection = useSelection();

  const cart: Cart = {
    outboundFlight: selection.outboundFlight,
    inboundFlight: selection.inboundFlight,
    hotel: selection.hotel,
  };
  const hasItems = cartHasItems(cart);

  const [proposing, setProposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persisted so navigating away from /explorer/booking and back
  // restores the same proposed booking. The BookingCard reads its
  // own status on mount, so if the user Confirmed or Cancelled since,
  // the card refetches and shows the current state.
  const [booking, setBooking] = usePersistedState<BookingLike | null>(
    PROPOSED_BOOKING_STORAGE_KEY,
    null,
  );

  // OAuth-return handshake — the /explorer/booking equivalent of
  // AnonChatResumeHandler's confirm-POST arm on `/`. Fires when the
  // page loads with `?confirm=<id>` after the user came back from
  // signing in via BookingCard's Confirm button.
  //
  // Precondition path: BookingCard reads usePathname() and sends the
  // user to `/explorer/booking?confirm=<id>` for its callbackUrl. So
  // when we land here signed in with that query param and the
  // persisted booking's id matches, we finish the confirm the user
  // originally clicked — otherwise they'd be stranded with a still-
  // PROPOSED booking, no obvious way forward, and the "signed out"
  // state gone.
  //
  // We update BookingPanel's own persisted `booking` (so subsequent
  // page visits see PAID) and dispatch the same `booking-updated`
  // window event PostSignInConfirmHandler uses — that's the mechanism
  // BookingCard already listens for to swap its in-memory snapshot
  // without a remount.
  const currentUser = useCurrentUser();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const oauthResumeFiredRef = useRef(false);

  // This effect exists to complete a job the user started but
  // couldn't finish while signed out — the Confirm-click-then-sign-in
  // round-trip.
  //
  // The problem it solves
  // Follow one user through the flow:
  //
  // 1. Anonymous user is on /explorer/booking, has proposed a booking
  //    (persisted in sessionStorage).
  // 2. They click Confirm on the BookingCard.
  // 3. BookingCard sees they aren't signed in (BookingCard.tsx:193-201)
  //    and fires the Google OAuth flow with a callback URL of
  //    /explorer/booking?confirm=<id>.
  // 4. Google authenticates them. They come back to
  //    /explorer/booking?confirm=<id>, now signed in.
  //
  // At this point, the confirm POST hasn't happened yet. The user's
  // original intent — "I want to confirm this booking" — is encoded
  // only in the ?confirm=<id> query param. Without this effect, they'd
  // land on the page, see the same PROPOSED booking card, and have to
  // click Confirm a second time. That's the bug the effect fixes.
  // One-sentence summary:
  // When the user returns from Google OAuth with a ?confirm=<id> that matches this tab's persisted booking, POST the confirm they originally clicked, update both BookingPanel's persisted snapshot and BookingCard's in-memory snapshot, strip the query param — and refuse to fire in any other situation.
  useEffect(() => {
    // Prevents double-firing. The effect's deps include searchParams, booking, and router — any of which can change while we're mid-flight. The ref latch says "I've already committed to this run once, don't start a second POST."
    if (oauthResumeFiredRef.current) return;

    // 	Prevents firing before auth finished loading. useCurrentUser() returns null during the "session status: loading" moment on mount. Firing then would 401 the POST.
    if (!currentUser) return;

    // Prevents firing before usePersistedState has hydrated. On first paint, booking is null because the storage read happens in an effect (SSR-safe two-render dance). Firing before hydration would POST /api/booking/undefined/confirm.
    if (!booking) return;

    const confirmParam = searchParams.get('confirm');

    // We're on the page but not returning from OAuth — the user just navigated here manually. Nothing to resume.
    if (!confirmParam) return;

    // Skip if the confirm param doesn't match the persisted booking's id.
    // Someone visited with a stale or mismatched query param — a bookmarked URL, back-button noise, or an id that belongs to a different booking than the one this tab has persisted. The effect refuses to confirm a booking the user didn't authorize this session.
    if (confirmParam !== String(booking.id)) return;

    // Mark that we've handled the OAuth-return handshake to prevent
    // re-entry from the same URL.
    oauthResumeFiredRef.current = true;

    // We use a self-invoking async function to handle the confirm request, because
    // useEffect callbacks cannot be async directly.
    void (async () => {
      try {
        // Send the confirm request to the server.
        // This is the POST the user would have made if they'd been signed in when they clicked Confirm. The server checks authorization (now the session cookie is valid) and flips the booking to PAID.
        const body = await confirmBooking(booking.id);

        // Updates BookingPanel's own usePersistedState cell → sessionStorage gets the PAID booking → a later reload shows the confirmed state, not the stale PROPOSED one.
        setBooking(body);

        // BookingCard has its own useState(initialBooking) seeded at mount. Updating BookingPanel's state doesn't automatically flow into BookingCard's snapshot. The booking-updated CustomEvent is the side-channel that pokes BookingCard's listener into calling setBooking(custom.detail) on itself — swapping its status chip to PAID without a remount. (See BookingCard.tsx, line 196 for the listener implementation.)
        //
        // Why a window event and not something more React-native
        // here? Two FOOTNOTES at the bottom of this file cover the
        // trade-offs against the two closest alternatives:
        //   - "Why not React Context instead of a window
        //     CustomEvent?" (two Context shapes considered, blast-
        //     radius comparison, three-question test).
        //   - "Why not make BookingCard a controlled prop instead of
        //     using a window CustomEvent?" (what "controlled" would
        //     demand from every caller, why the refactor doesn't
        //     actually reduce complexity, when controlled would be
        //     right).
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent<BookingLike>('booking-updated', {
              detail: body,
            }),
          );
        }
      } catch (err) {
        setError((err as Error).message);
      } finally {
        // Strip the `confirm` query param — done handling it.
        // The ?confirm=<id> param is spent. Whether the POST succeeded or failed, we've handled that query — leaving it in the URL is misleading (looks pending) and dangerous (a manual reload would re-satisfy the guards and maybe re-fire, though the ref would stop it in the same session).
        // Also, a subsequent Confirm click on this same page shouldn't
        // re-fire from a stale URL. Preserve any other params.
        const nextParams = new URLSearchParams(searchParams.toString());
        nextParams.delete('confirm');
        const nextSearch = nextParams.toString();
        router.replace(pathname + (nextSearch ? `?${nextSearch}` : ''));
      }
    })();
  }, [currentUser, booking, searchParams, pathname, router, setBooking]);

  async function propose() {
    if (!hasItems) return;

    setProposing(true);
    setError(null);

    try {
      // crypto.randomUUID is available on modern browsers and Node 19+
      // (which the app already targets). A fresh key per click means
      // an accidental double-click could produce two bookings; the
      // Button is disabled during the in-flight request, which is
      // enough for a demo.
      const idempotencyKey = `explorer:${crypto.randomUUID()}`;
      const payload = buildProposePayload(cart, idempotencyKey);

      const res = await fetch('/api/booking/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = (await res.json()) as
        | BookingLike
        | { error: string; code?: string };

      if (!res.ok) {
        throw new Error(
          'error' in body ? body.error : `Propose failed: HTTP ${res.status}`,
        );
      }

      // Cart makes way for the returned booking — otherwise the
      // SelectionBar would keep advertising items that are now
      // reserved on the row that just rendered below.
      selection.clearAll();
      setBooking(body as BookingLike);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProposing(false);
    }
  }

  return (
    <Stack spacing={4}>
      <PageHeader
        title="Booking"
        description="Terminus of the flight and hotel searches: reviews the cart the SelectionBar's been collecting, proposes it via POST /api/booking/propose, and hands the returned booking to the standard BookingCard for Confirm / Cancel."
      />

      <Paper variant="outlined" sx={{ p: 3 }}>
        <PanelHeader
          title="Proposed booking"
          endpoint="POST /api/booking/propose"
        />

        {booking ? (
          <Stack spacing={2} sx={{ mt: 2 }}>
            <BookingCard initialBooking={booking} />
            {/* Explicit exit from the persisted-proposal view.
                Without it, a booking survives forever in the tab and
                the user has no way to see the empty state / restart
                the cart flow from this page. */}
            <Stack direction="row" justifyContent="flex-end">
              <Button
                size="small"
                variant="text"
                onClick={() => setBooking(null)}
              >
                Start a new booking
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ mt: 2 }}>
            {hasItems ? (
              <CartSummary cart={cart} />
            ) : (
              <Alert severity="info">
                Nothing selected yet. Pick a flight from{' '}
                <strong>/explorer/flights</strong> and a hotel from{' '}
                <strong>/explorer/hotels</strong>, then come back here.
              </Alert>
            )}

            {error && <Alert severity="error">{error}</Alert>}

            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                onClick={propose}
                disabled={!hasItems || proposing}
                startIcon={
                  proposing ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <SendIcon />
                  )
                }
              >
                {proposing ? 'Proposing…' : 'Propose booking'}
              </Button>
            </Stack>
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

// ============================================================
// FOOTNOTE 1 — Why not React Context instead of a window CustomEvent?
// ============================================================
//
// Preserved conversation on the trade-off. Referenced from the
// resume effect above, which dispatches `booking-updated` on window
// rather than piping the fresh booking through a Context.
//
// Q: Another option, instead of dispatching a custom windows event,
// you touched upon is this:
//
//   "React Context around BookingCard — Adds a provider to every
//    mount site. Overkill when there's only one publisher and one
//    subscriber per page."
//
// Can you elaborate on that?
//
// A: Sure. Let me lay out what "using React Context" would actually
// look like — there are two shapes, both with real costs — and then
// explain why neither wins for our situation.
//
//
// Shape A: Context as a scoped event bus
//
// This is the most direct swap for the window event. Instead of
// dispatching on `window`, you dispatch on a Context-provided
// emitter:
//
//     type BookingBusValue = {
//       emit: (booking: BookingLike) => void;
//       subscribe: (cb: (booking: BookingLike) => void) => () => void;
//     };
//
//     const BookingBusContext = createContext<BookingBusValue | null>(null);
//
//     export function BookingBusProvider({ children }: { children: ReactNode }) {
//       const listeners = useRef(new Set<(b: BookingLike) => void>());
//       const value = useMemo<BookingBusValue>(() => ({
//         emit: (b) => listeners.current.forEach((cb) => cb(b)),
//         subscribe: (cb) => {
//           listeners.current.add(cb);
//           return () => listeners.current.delete(cb);
//         },
//       }), []);
//       return (
//         <BookingBusContext.Provider value={value}>
//           {children}
//         </BookingBusContext.Provider>
//       );
//     }
//
//     export function useBookingBus(): BookingBusValue {
//       const ctx = useContext(BookingBusContext);
//       if (!ctx) throw new Error('useBookingBus must be inside <BookingBusProvider>');
//       return ctx;
//     }
//
// Usage:
//
// BookingPanel replaces `window.dispatchEvent(...)` with:
//
//     const { emit } = useBookingBus();
//     // ...
//     emit(body);
//
// BookingCard replaces the window `addEventListener` with:
//
//     const { subscribe } = useBookingBus();
//     useEffect(() => {
//       const unsub = subscribe((updated) => {
//         if (updated.id === booking.id) setBooking(updated);
//       });
//       return unsub;
//     }, [booking.id, subscribe]);
//
// What did we gain? Type safety (`emit` takes `BookingLike`, not
// `any`) and namespace isolation (only components inside the
// provider can emit or subscribe — third-party code can't wire
// itself in). Same pub/sub semantics, just scoped to a subtree.
//
// What did it cost? A provider now has to sit above every place a
// BookingCard mounts. Let me trace where those places are:
//
//   1. `/explorer/booking` — one card, one provider around the panel
//      or the layout. Cheap.
//
//   2. The chat surface (`/`, `/c/[id]`) — every chat message that
//      includes a proposed-booking tool call renders a BookingCard.
//      So the provider has to wrap either:
//        - Each `ChatMessage` individually (per-message providers
//          with per-message emitter state — pointless, since each
//          card is its own island).
//        - The whole `ChatContainer` (one provider covers all
//          messages — reasonable).
//        - The `RootLayout` (global provider — app-wide side
//          channel with a Context flavor).
//
// Options 2 and 3 both work, but they mean another provider in the
// wiring that the window-event version doesn't need. And you're
// paying that cost in exchange for... a slightly nicer type story
// and a slightly smaller namespace.
//
//
// Shape B: Context as the source-of-truth (fully controlled)
//
// This is the more ambitious version — the one the "controlled
// prop" alternative from earlier maps into. The context holds the
// booking itself:
//
//     type BookingContextValue = {
//       booking: BookingLike;
//       setBooking: (updated: BookingLike) => void;
//     };
//
//     const BookingContext = createContext<BookingContextValue | null>(null);
//
//     export function BookingProvider({
//       initial,
//       children,
//     }: {
//       initial: BookingLike;
//       children: ReactNode;
//     }) {
//       const [booking, setBooking] = useState<BookingLike>(initial);
//       const value = useMemo(() => ({ booking, setBooking }), [booking]);
//       return (
//         <BookingContext.Provider value={value}>{children}</BookingContext.Provider>
//       );
//     }
//
// Usage:
//
// BookingCard is refactored to drop its internal `useState` and read
// from context:
//
//     export function BookingCard() {
//       const { booking, setBooking } = useContext(BookingContext)!;
//       // ... every setBooking(...) call works exactly as before,
//       // it just now flows through the provider
//     }
//
// BookingPanel wraps its own booking around a
// `<BookingProvider initial={persistedBooking}>`. Any external
// update — the OAuth-resume POST, the mount refetch, the
// sessionStorage handoff — calls `setBooking` and everything
// downstream reacts to it because the provider re-renders.
//
// What we gain: The `booking-updated` window event goes away
// entirely. So does the `readPendingConfirmedBooking` sessionStorage
// handoff between AnonChatResumeHandler and BookingCard — the
// resume handler just calls `setBooking` on the provider. Cleaner
// data flow, no side channels, purely reactive.
//
// What it costs:
//
//   1. BookingCard becomes uncomposable without a provider. Anyone
//      rendering it must first wrap it. This is the "adds a
//      provider to every mount site" line from earlier.
//
//   2. The mount refetch and the `readPendingConfirmedBooking`
//      handshake either stay in BookingCard (and now write to the
//      provider via `setBooking`) or move to every caller. Moving
//      them means every chat-message renderer that shows a card
//      duplicates that logic. Keeping them in BookingCard means the
//      card still owns all the update logic — we've moved WHERE the
//      state lives (into the provider) but not WHAT code updates
//      it. So we've paid the provider cost without eliminating the
//      update mechanisms it was supposed to simplify.
//
//   3. One provider per card, not one provider for all cards. This
//      is subtle: each card corresponds to a DIFFERENT booking. So
//      you can't have a single top-level provider — each card needs
//      its own. Which means either:
//        - The chat-message renderer wraps each rendered BookingCard
//          in a `<BookingProvider initial={parsedBooking}>`. That's
//          a provider-per-instance pattern — Context does support
//          it, but it's using a heavy tool for a light job.
//        - Or the provider holds a `Map<bookingId, BookingLike>`
//          and each consumer reads its own entry, which is
//          essentially a small Redux store for two components.
//
//
// The blast-radius comparison
//
//   Approach                        | Setup at each mount site
//   --------------------------------|-------------------------------
//   Window `CustomEvent` (today)    | Zero — just render
//                                   | `<BookingCard initialBooking=...>`.
//   Shape A: Context event bus      | `<BookingBusProvider>` at some
//                                   | common ancestor.
//   Shape B: Context state holder   | `<BookingProvider initial=...>`
//                                   | per card. Every caller must
//                                   | provide the initial value.
//
//   Approach                        | BookingCard shape
//   --------------------------------|-------------------------------
//   Window `CustomEvent` (today)    | Uncontrolled. Owns internal
//                                   | `useState`.
//   Shape A: Context event bus      | Uncontrolled (unchanged). Owns
//                                   | internal `useState`.
//   Shape B: Context state holder   | Fully controlled. No internal
//                                   | state.
//
//   Approach                        | Update logic lives in
//   --------------------------------|-------------------------------
//   Window `CustomEvent` (today)    | BookingCard (mount refetch,
//                                   | sessionStorage read, window
//                                   | listener, click handlers).
//   Shape A: Context event bus      | BookingCard, but subscribing
//                                   | via context instead of window.
//   Shape B: Context state holder   | Either BookingCard (writes to
//                                   | context) or every caller
//                                   | (duplicated).
//
//
// Why neither fits our case
//
// The three-question test:
//
// Q: Do multiple things outside BookingCard need to observe the
// current booking?
//
// No. BookingPanel writes it once via `setBooking` (its own
// persisted state) and dispatches the event; it doesn't READ status
// changes anywhere in its own render. Chat messages don't read
// status changes at all. The only reader is BookingCard itself.
// Context excels at fan-out to many readers — we have exactly one.
//
// Q: Is there a natural provider ancestor?
//
// Not really. BookingPanel is on `/explorer/booking`; chat messages
// are under `ChatContainer`. Their nearest common ancestor is the
// root layout. Putting the provider at the root works but it's the
// same "global side channel" the window event is — just with more
// scaffolding.
//
// Q: Are we already using Context for this domain?
//
// No. There's `SelectionContext`, but it's for cart selections, not
// bookings. Introducing a second, single-purpose booking Context
// adds a mental slot ("which context does this concern belong to?")
// for something that fires once per rare event.
//
//
// When Context would actually be right here
//
// If the app grew to have multiple simultaneous views of the same
// booking — say, a "your recent bookings" sidebar, a modal preview,
// and the BookingCard on `/explorer/booking` all showing the same
// PROPOSED booking that then flips to PAID — Context (Shape B)
// would be the right answer. All three views would derive from one
// source of truth; a single `setBooking` would fan out.
//
// Right now we have one view per booking. Fan-out is 1:1. That's
// the shape where the window event is proportionate — a small,
// targeted broadcast for a small, targeted receiver — and Context
// is over-engineered.
//
//
// The bottom line
//
// Context is at its best when:
//   - Many components need to read one value.
//   - The value changes and multiple views must stay in sync.
//   - The concern is naturally scoped to a subtree.
//
// Our case is:
//   - One component reads the value (BookingCard).
//   - The value changes rarely and needs one view to update.
//   - The publisher and subscriber don't share a small natural
//     subtree.
//
// `window.dispatchEvent` is the right tool for "small, targeted,
// rare, cross-tree signal that already lives in the browser
// runtime." Context is the right tool for "shared state that
// multiple views derive from." We have the first, not the second —
// hence the pick.

// ============================================================
// FOOTNOTE 2 — Why not make BookingCard a controlled prop instead
// of using a window CustomEvent?
// ============================================================
//
// Preserved conversation on the trade-off. Referenced from the
// resume effect above, which dispatches `booking-updated` on window
// rather than hoisting the booking into a prop the caller drives.
//
// Q: You said:
//
//   "Pass booking as a controlled prop and remove BookingCard's
//    internal state — Would work, but requires refactoring every
//    existing caller of BookingCard (chat surface too) to hold the
//    booking in an external store. Big blast radius for a small
//    purpose."
//
// Can you elaborate on that?
//
// A: Sure. This comes down to what makes BookingCard uncontrolled
// today versus what controlled would demand from callers.
//
//
// What "uncontrolled" means today
//
// BookingCard is shaped like an uncontrolled `<input>`:
//
//     export function BookingCard({ initialBooking }: { initialBooking: BookingLike }) {
//       const [booking, setBooking] = useState<BookingLike>(initialBooking);
//       //     ^^^^^^^ owned by BookingCard from mount onward
//       ...
//     }
//
// The parent seeds an initial value. From then on, BookingCard owns
// the state. It updates it through several internal paths:
//
//   - The mount-effect refetch at BookingCard.tsx:112-148 — GET
//     /api/booking/<id> at mount, replaces `booking` with the fresh
//     server snapshot.
//   - The `readPendingConfirmedBooking` sessionStorage read at
//     BookingCard.tsx:116-121 — picks up the confirmed booking
//     AnonChatResumeHandler stashed there.
//   - The `booking-updated` window listener at
//     BookingCard.tsx:174-189 — the mechanism we just discussed.
//   - Its own `callBookingAction` at BookingCard.tsx:220 — clicks
//     Confirm/Cancel, POSTs, setBooking(response).
//
// Four different reasons the "current booking" might change, and
// every one of them mutates BookingCard's own state. The parent
// never has to hear about it.
//
//
// What "controlled" would look like
//
// The refactored signature:
//
//     type BookingCardProps = {
//       booking: BookingLike;
//       onChange: (next: BookingLike) => void;
//     };
//
//     export function BookingCard({ booking, onChange }: BookingCardProps) {
//       // No more useState<BookingLike>(initialBooking).
//       // Everywhere the code used to do `setBooking(fresh)` it now does `onChange(fresh)`.
//       ...
//     }
//
// That looks simpler in isolation. The cost hides in what every
// parent now has to do.
//
//
// What each caller has to add
//
// Every place that mounts BookingCard becomes a stateful holder of
// the booking, whether or not it cares about updates:
//
// In `BookingPanel`: almost a no-op, actually — it already holds
// the booking in `usePersistedState`. Change one prop name
// (`initialBooking` → `booking`) and one line (`setBooking` as
// `onChange`). This is the EASY caller.
//
// In the chat surface: this is where the blast radius lives.
// Bookings appear inside chat messages that came from tool-call
// results. Trace the ownership:
//
//   - A chat message currently renders BookingCard with
//     initialBooking={parseBookingFromToolOutput(msg)}. The renderer
//     is stateless.
//   - If BookingCard becomes controlled, that message renderer must
//     now:
//       1. Hold each booking in its own `useState`. Per-message
//          state.
//       2. Hydrate it once from the tool output when the message is
//          first shown.
//       3. Provide the `onChange` callback.
//       4. Decide what to do when the message is virtualized /
//          scrolled away and re-mounts later — either restore from
//          a cache or accept losing status updates.
//       5. Coordinate with all four update sources listed above
//          (refetch, sessionStorage, window event, Confirm/Cancel).
//
// That's a real refactor of the message renderer(s). Every message
// that could contain a booking becomes stateful. And the state's
// lifetime depends on the parent tree's behavior — if the chat
// virtualizes, unmounts, or re-parents its message list, the state
// disappears unless someone lifts it further up.
//
// The four update sources don't go away either. They just move.
//
//   Update source                 | Uncontrolled (today)   | Controlled
//   ------------------------------|------------------------|------------------
//   Mount refetch                 | Inside BookingCard     | Either inside BookingCard,
//   (GET /api/booking/<id>)       |                        | or every parent
//                                 |                        | duplicates the mount effect.
//   ------------------------------|------------------------|------------------
//   readPendingConfirmedBooking   | Inside BookingCard     | Either inside BookingCard,
//   sessionStorage                |                        | or every chat-message
//                                 |                        | renderer becomes coupled
//                                 |                        | to the anon-auth
//                                 |                        | handoff protocol.
//   ------------------------------|------------------------|------------------
//   booking-updated window        | Inside BookingCard     | Same choice.
//   listener                      |                        |
//   ------------------------------|------------------------|------------------
//   Confirm/Cancel POST result    | Inside BookingCard     | onChange from BookingCard —
//                                 |                        | button click still owned
//                                 |                        | by the card, but state
//                                 |                        | now travels through
//                                 |                        | the parent.
//
// Notice the pattern: keep the logic inside BookingCard and the
// card just calls `onChange` instead of `setBooking`. That's the
// pragmatic choice — but it means the parent state is a passive
// shadow that BookingCard drives anyway. We've moved the state
// out, but not the logic. All we've bought is one less side-
// channel (the window event) at the cost of every caller becoming
// a state-holder.
//
// Alternatively, hoist the logic too: each parent runs its own
// mount refetch, its own sessionStorage read, its own event
// listener. That's genuine simplification for BookingCard but
// genuine duplication for callers. Worse trade.
//
//
// Why it isn't worth it in our case
//
// The three-question test I apply to "should this be controlled":
//
// 1. Does more than one thing outside the component care about
//    this state? In our case, no. BookingPanel cares about the
//    booking because it needs to persist it — but it doesn't REACT
//    to status changes (nothing else in BookingPanel changes when
//    the booking flips from PROPOSED to PAID). Chat message
//    renderers don't care at all — they show the card once and
//    forget about it.
//
// 2. Does the parent produce updates the child needs to see
//    reactively? Our parent only needs to inject an initial value
//    once. Everything after mount is the child's problem —
//    refetches, user clicks, background events. This is exactly the
//    uncontrolled-input use case.
//
// 3. Are there multiple parents that need to stay in sync? No.
//    Each BookingCard corresponds to one booking, mounted in one
//    place.
//
// None of the three signals point to controlled. The window event
// is the right shape for what it does: "hey, this rare edge case
// happened, please refresh your snapshot."
//
//
// The general principle
//
// Uncontrolled + side-channel event: complexity concentrated in
// one file (BookingCard), one side-channel to maintain, callers
// stay simple.
//
// Controlled: complexity distributed across every caller, no side-
// channel needed, but every caller now holds state it doesn't
// otherwise care about.
//
// The side-channel FEELS wrong because it dodges React's data flow.
// But that's exactly what makes it cheap for a rare, one-
// directional signal. If you flipped the polarity — parent needs
// to OBSERVE status changes to render a summary elsewhere —
// controlled would be right and the window event would look silly.
// The right shape follows the direction of the data need, and here
// the data need runs child → world (Confirm click, refetch), not
// parent → child (except at initial mount).
