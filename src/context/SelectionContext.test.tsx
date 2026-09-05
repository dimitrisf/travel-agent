// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  SelectionProvider,
  useSelection,
  isSelectedFlight,
  isSelectedHotel,
  type SelectedFlight,
  type SelectedHotel,
} from './SelectionContext';

// Fixed sample payloads. Kept as functions so tests can freely mutate
// a shallow copy without cross-contaminating other cases.
const flightA = (): SelectedFlight => ({
  flight_instance_id: 101,
  cabin_class: 'economy',
  seats: 2,
  priceEUR: 200,
  totalEUR: 400,
  label: 'Aegean A3 824 · ATH → BER',
});
const flightB = (): SelectedFlight => ({
  flight_instance_id: 202,
  cabin_class: 'business',
  seats: 1,
  priceEUR: 900,
  totalEUR: 900,
  label: 'Lufthansa LH 1753 · ATH → BER',
});
const hotelA = (): SelectedHotel => ({
  room_type_id: 55,
  checkin: '2026-09-05',
  checkout: '2026-09-08',
  guests: 2,
  rooms: 1,
  nights: 3,
  pricePerNightEUR: 130,
  totalEUR: 390,
  label: 'Brooklyn Bay Inn · Standard',
});

// Test harness that exposes the context via visible DOM so assertions
// stay in the same style as the rest of the app's component tests
// (getByText / getByRole rather than reaching into hooks). The three
// buttons drive the store; the two <div>s report its state.
function Harness() {
  const sel = useSelection();
  return (
    <div>
      <button onClick={() => sel.toggleFlight(flightA())}>toggleA</button>
      <button onClick={() => sel.toggleFlight(flightB())}>toggleB</button>
      <button onClick={() => sel.toggleHotel(hotelA())}>toggleHotelA</button>
      <button onClick={() => sel.clearAll()}>clearAll</button>
      <div data-testid="flight">
        {sel.flight
          ? `${sel.flight.flight_instance_id}/${sel.flight.cabin_class}`
          : 'none'}
      </div>
      <div data-testid="hotel">
        {sel.hotel ? String(sel.hotel.room_type_id) : 'none'}
      </div>
      <div data-testid="isFlightASelected">
        {String(isSelectedFlight(sel, flightA()))}
      </div>
      <div data-testid="isHotelASelected">
        {String(isSelectedHotel(sel, hotelA()))}
      </div>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <SelectionProvider>
      <Harness />
    </SelectionProvider>,
  );
}

describe('SelectionContext', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it('starts empty', () => {
    renderWithProvider();
    expect(screen.getByTestId('flight')).toHaveTextContent('none');
    expect(screen.getByTestId('hotel')).toHaveTextContent('none');
  });

  it('selects a flight when its row is clicked', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByText('toggleA'));
    expect(screen.getByTestId('flight')).toHaveTextContent('101/economy');
    expect(screen.getByTestId('isFlightASelected')).toHaveTextContent('true');
  });

  it('replaces the selected flight when a different row is clicked', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByText('toggleA'));
    await user.click(screen.getByText('toggleB'));
    // Slice-1 constraint: at most one flight — B replaces A.
    expect(screen.getByTestId('flight')).toHaveTextContent('202/business');
  });

  it('deselects when the currently-selected row is clicked again', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByText('toggleA'));
    await user.click(screen.getByText('toggleA'));
    expect(screen.getByTestId('flight')).toHaveTextContent('none');
    expect(screen.getByTestId('isFlightASelected')).toHaveTextContent('false');
  });

  it('flight and hotel selections are independent', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByText('toggleA'));
    await user.click(screen.getByText('toggleHotelA'));
    expect(screen.getByTestId('flight')).toHaveTextContent('101/economy');
    expect(screen.getByTestId('hotel')).toHaveTextContent('55');
    expect(screen.getByTestId('isHotelASelected')).toHaveTextContent('true');
  });

  it('clearAll wipes both slots', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByText('toggleA'));
    await user.click(screen.getByText('toggleHotelA'));
    await user.click(screen.getByText('clearAll'));
    expect(screen.getByTestId('flight')).toHaveTextContent('none');
    expect(screen.getByTestId('hotel')).toHaveTextContent('none');
  });

  it('persists selection to sessionStorage', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByText('toggleA'));
    const raw = sessionStorage.getItem('explorer:selection:v1');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.flight.flight_instance_id).toBe(101);
  });

  it('rehydrates a previously-persisted selection on mount', () => {
    sessionStorage.setItem(
      'explorer:selection:v1',
      JSON.stringify({ flight: flightA(), hotel: null }),
    );
    renderWithProvider();
    // The hydrate effect fires post-mount; act flushes it.
    act(() => {});
    expect(screen.getByTestId('flight')).toHaveTextContent('101/economy');
  });

  it('throws when useSelection is called outside its provider', () => {
    // Silence React's error-boundary warning for this specific throw.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Harness />)).toThrow(
      /useSelection must be used inside/,
    );
    errSpy.mockRestore();
  });
});
