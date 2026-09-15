import { Suspense } from 'react';
import { BookingPanel } from '@/components/explorer/booking/BookingPanel';

// Thin app-router entry. All logic lives in BookingPanel so the
// vitest suite (which globs `src/**/*.test.{ts,tsx}`) can cover it.
//
// Suspense boundary wraps BookingPanel because it reads
// useSearchParams() for the ?confirm=<id> OAuth-return handshake.
// Next.js requires that call to sit under a Suspense boundary at
// build time — without it, `next build` fails with
// "useSearchParams() should be wrapped in a suspense boundary at
// page '/explorer/booking'" during static prerender (see
// https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout).
// A null fallback is fine here: the panel hydrates so fast on the
// client that any visible placeholder would just flash and go.
export default function ExplorerBookingPage() {
  return (
    <Suspense fallback={null}>
      <BookingPanel />
    </Suspense>
  );
}
