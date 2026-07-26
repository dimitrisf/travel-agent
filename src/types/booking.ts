export type BookingStatus =
  | 'PROPOSED'
  | 'CONFIRMED'
  | 'PAID'
  | 'CANCELLED'
  | 'FAILED';

// BookingLike is a simplified representation of a booking object returned by the travel agent's booking tools. It includes the booking ID, reference, status, customer information, total price, and arrays of flight and hotel bookings associated with the booking. Each flight booking includes details about the flight instance, cabin class, number of travelers, and total price. Each hotel booking includes details about the check-in/check-out dates, number of nights, guests, rooms, total price, and room type information.
// It's a structural type matching the API's fully-populated Booking JSON (flight + hotel line items with nested airline/airport/city and hotel/city).
export type BookingLike = {
  id: number;
  reference: string;
  status: BookingStatus;
  // Nullable as of Stage 17 Phase 2 — anon PROPOSED bookings have no customer
  // identity until someone signs in and confirms them.
  customerName: string | null;
  customerEmail: string | null;
  totalPriceEUR: number;
  currency: string;
  cancellationReason: string | null;
  flightBookings: Array<{
    id: number;
    cabinClass: string;
    adults: number;
    children: number;
    seats: number;
    totalPriceEUR: number;
    flightInstance: {
      id: number;
      departureDatetime: string;
      arrivalDatetime: string;
      flightDefinition: {
        flightNumber: string;
        airline: { iataCode: string; name: string };
        originAirport: {
          iataCode: string;
          name: string;
          city: { name: string };
        };
        destinationAirport: {
          iataCode: string;
          name: string;
          city: { name: string };
        };
      };
    };
  }>;
  hotelBookings: Array<{
    id: number;
    checkinDate: string;
    checkoutDate: string;
    nights: number;
    guests: number;
    rooms: number;
    totalPriceEUR: number;
    roomType: {
      name: string;
      hotel: {
        name: string;
        address: string;
        stars: number;
        city: { name: string };
      };
    };
  }>;
};
