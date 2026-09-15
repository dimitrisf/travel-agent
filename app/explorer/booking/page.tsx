import { BookingPanel } from '@/components/explorer/booking/BookingPanel';

// Thin app-router entry. All logic lives in BookingPanel so the
// vitest suite (which globs `src/**/*.test.{ts,tsx}`) can cover it.
export default function ExplorerBookingPage() {
  return <BookingPanel />;
}
