import type { AgentInputItem } from '@openai/agents';
import type { BookingLike } from '@/types/booking';

// Anon-chat persistence (Stage 17 Phase 3.5). While a user is anonymous
// AND on `/` (no conversation id yet), ChatContainer auto-saves the
// running history to sessionStorage on every turn. If the user then
// signs in mid-flow (via the Confirm button in a BookingCard or the
// header Sign In), AnonChatResumeHandler picks up the saved history,
// POSTs it to /api/conversations to create a Conversation owned by the
// now-signed-in user, and navigates to /c/[id].
//
// sessionStorage (not localStorage): matches the anon = tab-scoped
// contract. Clears on tab close. Bonus effect — anon chat also survives
// a page refresh within the same tab.
// Why sessionStorage vs localStorage? Anon = tab-scoped. localStorage would let an anon chat outlive the tab (leaks across tabs, survives browser restart) — matches neither user intuition nor the security model.

// Read functions all guard typeof window === 'undefined' for SSR-safety and swallow all storage exceptions (private mode, quota, etc.) — worst case the feature silently degrades.

const STORAGE_KEY = 'anon-chat-history-v1';

// Post-resume handoff keys. When AnonChatResumeHandler runs the confirm
// POST in parallel with the conversation-create POST, the results have
// to survive a router.replace() into /c/[id] and be picked up by the
// components rendered there — BookingCard (needs the freshly-PAID
// booking so it doesn't refetch and flicker) and PostSignInConfirmHandler
// (needs the snackbar copy so it doesn't re-POST). sessionStorage is the
// simplest cross-navigation bus we already trust for the tab-scoped
// resume flow.
const CONFIRMED_BOOKING_KEY = 'anon-resume-confirmed-booking-v1';
const PENDING_SNACKBAR_KEY = 'anon-resume-snackbar-v1';

export type PendingSnackbar = {
  severity: 'success' | 'error';
  message: string;
};

// Safe getter — returns null on the server (no window) and on parse
// errors. sessionStorage access can throw in some private-mode setups
// too; we swallow those to fail closed rather than crash the UI.
export function readAnonChatHistory(): AgentInputItem[] | null {
  // Guard against server-side execution (no window) and private-mode
  // storage access errors. We don't want to crash the UI if the user is
  // in a weird environment.

  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);

    // Guard against a stale entry (e.g. user signed in and created a
    // conversation, then cleared their chat). We don't want to restore an
    // empty history and overwrite the DB-backed conversation.
    if (!raw) return null;

    // raw should be a JSON string of an array of AgentInputItem objects. If it's not, return null to avoid restoring invalid data.
    const parsed = JSON.parse(raw) as unknown;

    // parsed should be an array of AgentInputItem objects. If it's not, return null to avoid restoring invalid data.
    if (!Array.isArray(parsed)) return null;

    return parsed as AgentInputItem[];
  } catch {
    return null;
  }
}

// Writes the history to sessionStorage. Empty arrays remove the key so
// a stale save doesn't linger when the user clears their input mid-flow.
// Same safe-swallow policy as read for consistency.
export function saveAnonChatHistory(history: AgentInputItem[]): void {
  // Guard against server-side execution (no window) and private-mode
  // storage access errors. We don't want to crash the UI if the user is
  // in a weird environment.

  if (typeof window === 'undefined') return;

  try {
    if (history.length === 0) {
      // Empty history means the user cleared their chat. Remove the key so
      // a stale save doesn't linger and get restored after an OAuth round-trip.
      window.sessionStorage.removeItem(STORAGE_KEY);
      return;
    }

    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Storage quota exceeded, private mode, etc. Silently drop — the
    // user still has their chat in React state; only cross-nav preserve
    // is lost.
  }
}

export function clearAnonChatHistory(): void {
  // Guard against server-side execution (no window) and private-mode
  // storage access errors. We don't want to crash the UI if the user is
  // in a weird environment.
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Same silent-drop as save.
  }
}

// ── Post-resume handoff (parallel POST optimisation) ──────────────────
//
// AnonChatResumeHandler now fires the conversation-create POST and the
// booking-confirm POST in parallel (cuts total wait ~in half). The
// confirm result has to survive the router.replace into /c/[id]:
//   - BookingCard reads readPendingConfirmedBooking(id) on mount and
//     upgrades PROPOSED → PAID synchronously, skipping the refetch.
//   - PostSignInConfirmHandler reads readPendingSnackbar() and renders
//     the snackbar without POSTing, since the confirm already happened.
// Both readers clear their own key after consuming it, so a hard refresh
// won't re-fire the effect.

export function savePendingConfirmedBooking(booking: BookingLike): void {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(
      CONFIRMED_BOOKING_KEY,
      JSON.stringify(booking),
    );
  } catch {
    // Silent — worst case, BookingCard falls back to refetch-on-mount.
  }
}

// Reads the pending confirmed booking from sessionStorage. Returns null if not found or if the id doesn't match. This is used by BookingCard to upgrade the booking status to PAID without refetching.
// id is the booking id that BookingCard is currently rendering. If the stored booking has a different id, we return null to avoid accidentally upgrading a different booking.
export function readPendingConfirmedBooking(id: number): BookingLike | null {
  if (typeof window === 'undefined') return null;

  try {
    // Read the raw JSON string from sessionStorage. If it's not found, return null.
    const raw = window.sessionStorage.getItem(CONFIRMED_BOOKING_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as BookingLike;

    // Guard against a stale entry (e.g. two proposals in the same tab,
    // only one confirmed) accidentally overwriting a different card.
    if (parsed?.id !== id) return null;

    return parsed;
  } catch {
    return null;
  }
}

// Clears the pending confirmed booking from sessionStorage. This is called by BookingCard after it has consumed the pending booking to avoid reusing it on a hard refresh.
export function clearPendingConfirmedBooking(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(CONFIRMED_BOOKING_KEY);
  } catch {
    // Silent.
  }
}

export function savePendingSnackbar(snackbar: PendingSnackbar): void {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(
      PENDING_SNACKBAR_KEY,
      JSON.stringify(snackbar),
    );
  } catch {
    // Silent — user just misses the snackbar; card state is unaffected.
  }
}

// Reads the pending snackbar from sessionStorage. Returns null if not found or if the severity is invalid. This is used by PostSignInConfirmHandler to render the snackbar without re-POSTing.
export function readPendingSnackbar(): PendingSnackbar | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(PENDING_SNACKBAR_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as PendingSnackbar;

    if (parsed?.severity !== 'success' && parsed?.severity !== 'error') {
      return null;
    }

    if (typeof parsed.message !== 'string') return null;

    return parsed;
  } catch {
    return null;
  }
}

// Clears the pending snackbar from sessionStorage. This is called by PostSignInConfirmHandler after it has consumed the pending snackbar to avoid reusing it on a hard refresh.
export function clearPendingSnackbar(): void {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.removeItem(PENDING_SNACKBAR_KEY);
  } catch {
    // Silent.
  }
}
