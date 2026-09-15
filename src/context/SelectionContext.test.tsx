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
const outboundA = (): SelectedFlight => ({
  flight_instance_id: 101,
  cabin_class: 'economy',
  adults: 2,
  children: 0,
  priceEUR: 200,
  totalEUR: 400,
  label: 'Aegean A3 824 · ATH → BER',
});
const outboundB = (): SelectedFlight => ({
  flight_instance_id: 202,
  cabin_class: 'business',
  adults: 1,
  children: 0,
  priceEUR: 900,
  totalEUR: 900,
  label: 'Lufthansa LH 1753 · ATH → BER',
});
const inboundA = (): SelectedFlight => ({
  flight_instance_id: 303,
  cabin_class: 'economy',
  adults: 2,
  children: 0,
  priceEUR: 180,
  totalEUR: 360,
  label: 'Aegean A3 825 · BER → ATH',
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
// (getByText / getByRole rather than reaching into hooks).
function Harness() {
  const sel = useSelection();
  return (
    <div>
      <button onClick={() => sel.toggleOutboundFlight(outboundA())}>
        toggleOutboundA
      </button>
      <button onClick={() => sel.toggleOutboundFlight(outboundB())}>
        toggleOutboundB
      </button>
      <button onClick={() => sel.toggleInboundFlight(inboundA())}>
        toggleInboundA
      </button>
      <button onClick={() => sel.toggleHotel(hotelA())}>toggleHotelA</button>
      <button onClick={() => sel.clearAll()}>clearAll</button>
      <div data-testid="outbound">
        {sel.outboundFlight
          ? `${sel.outboundFlight.flight_instance_id}/${sel.outboundFlight.cabin_class}`
          : 'none'}
      </div>
      <div data-testid="inbound">
        {sel.inboundFlight
          ? `${sel.inboundFlight.flight_instance_id}/${sel.inboundFlight.cabin_class}`
          : 'none'}
      </div>
      <div data-testid="hotel">
        {sel.hotel ? String(sel.hotel.room_type_id) : 'none'}
      </div>
      <div data-testid="isOutboundASelected">
        {String(isSelectedFlight(sel, outboundA(), 'outbound'))}
      </div>
      <div data-testid="isInboundASelected">
        {String(isSelectedFlight(sel, inboundA(), 'inbound'))}
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

  it('starts empty (outbound, inbound, hotel all null)', () => {
    renderWithProvider();
    expect(screen.getByTestId('outbound')).toHaveTextContent('none');
    expect(screen.getByTestId('inbound')).toHaveTextContent('none');
    expect(screen.getByTestId('hotel')).toHaveTextContent('none');
  });

  it('selects an outbound flight without touching the inbound slot', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByText('toggleOutboundA'));
    expect(screen.getByTestId('outbound')).toHaveTextContent('101/economy');
    expect(screen.getByTestId('inbound')).toHaveTextContent('none');
    expect(screen.getByTestId('isOutboundASelected')).toHaveTextContent('true');
  });

  it('selects an inbound flight without touching the outbound slot', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByText('toggleInboundA'));
    expect(screen.getByTestId('inbound')).toHaveTextContent('303/economy');
    expect(screen.getByTestId('outbound')).toHaveTextContent('none');
    expect(screen.getByTestId('isInboundASelected')).toHaveTextContent('true');
  });

  it('replaces the outbound flight when a different outbound row is clicked', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByText('toggleOutboundA'));
    await user.click(screen.getByText('toggleOutboundB'));
    // Slice-2 constraint: at most one outbound flight — B replaces A.
    expect(screen.getByTestId('outbound')).toHaveTextContent('202/business');
    expect(screen.getByTestId('inbound')).toHaveTextContent('none');
  });

  it('deselects when the currently-selected outbound row is clicked again', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByText('toggleOutboundA'));
    await user.click(screen.getByText('toggleOutboundA'));
    expect(screen.getByTestId('outbound')).toHaveTextContent('none');
    expect(screen.getByTestId('isOutboundASelected')).toHaveTextContent('false');
  });

  it('outbound, inbound, and hotel selections are all independent', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByText('toggleOutboundA'));
    await user.click(screen.getByText('toggleInboundA'));
    await user.click(screen.getByText('toggleHotelA'));
    expect(screen.getByTestId('outbound')).toHaveTextContent('101/economy');
    expect(screen.getByTestId('inbound')).toHaveTextContent('303/economy');
    expect(screen.getByTestId('hotel')).toHaveTextContent('55');
  });

  it('clearAll wipes all three slots', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByText('toggleOutboundA'));
    await user.click(screen.getByText('toggleInboundA'));
    await user.click(screen.getByText('toggleHotelA'));
    await user.click(screen.getByText('clearAll'));
    expect(screen.getByTestId('outbound')).toHaveTextContent('none');
    expect(screen.getByTestId('inbound')).toHaveTextContent('none');
    expect(screen.getByTestId('hotel')).toHaveTextContent('none');
  });

  it('persists selection to sessionStorage under the v2 key', async () => {
    const user = userEvent.setup();
    renderWithProvider();
    await user.click(screen.getByText('toggleOutboundA'));
    const raw = sessionStorage.getItem('explorer:selection:v2');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed.outboundFlight.flight_instance_id).toBe(101);
    expect(parsed.inboundFlight).toBeNull();
    expect(parsed.hotel).toBeNull();
  });

  it('rehydrates a previously-persisted selection on mount', () => {
    sessionStorage.setItem(
      'explorer:selection:v2',
      JSON.stringify({
        outboundFlight: outboundA(),
        inboundFlight: inboundA(),
        hotel: null,
      }),
    );
    renderWithProvider();
    // The hydrate effect fires post-mount; act flushes it.
    act(() => {});
    expect(screen.getByTestId('outbound')).toHaveTextContent('101/economy');
    expect(screen.getByTestId('inbound')).toHaveTextContent('303/economy');
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
