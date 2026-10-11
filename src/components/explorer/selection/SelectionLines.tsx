import FlightTakeoffIcon from '@mui/icons-material/FlightTakeoff';
import FlightLandIcon from '@mui/icons-material/FlightLand';
import HotelIcon from '@mui/icons-material/Hotel';
import { formatFlightLabel, formatHotelLabel } from '@/utils/booking';
import type { SelectedFlight, SelectedHotel } from '@/context/SelectionContext';
import { SelectionLine } from './SelectionLine';

// The three per-selection rows that make up the primary content
// column of SelectionBar: outbound flight, inbound flight, hotel.
// Each is rendered only when present, so the component naturally
// collapses when the cart is partial. Takes the three slots as
// props rather than reading SelectionContext itself — SelectionBar
// stays the single context reader, which keeps this component
// trivial to render in isolation (tests, Storybook, etc.).
//
// Label strings are composed by formatFlightLabel / formatHotelLabel
// at render time, so date-format changes propagate to existing cart
// entries without a clear-and-reselect round trip.

type SelectionLinesProps = {
  outboundFlight: SelectedFlight | null;
  inboundFlight: SelectedFlight | null;
  hotel: SelectedHotel | null;
};

export function SelectionLines({
  outboundFlight,
  inboundFlight,
  hotel,
}: SelectionLinesProps) {
  return (
    <>
      {outboundFlight && (
        <SelectionLine
          icon={<FlightTakeoffIcon fontSize="small" color="action" />}
          labelPrefix="Outbound"
          label={formatFlightLabel(outboundFlight)}
          priceEUR={outboundFlight.totalEUR}
        />
      )}
      {inboundFlight && (
        <SelectionLine
          icon={<FlightLandIcon fontSize="small" color="action" />}
          labelPrefix="Return"
          label={formatFlightLabel(inboundFlight)}
          priceEUR={inboundFlight.totalEUR}
        />
      )}
      {hotel && (
        <SelectionLine
          icon={<HotelIcon fontSize="small" color="action" />}
          labelPrefix="Hotel"
          label={formatHotelLabel(hotel)}
          priceEUR={hotel.totalEUR}
        />
      )}
    </>
  );
}
