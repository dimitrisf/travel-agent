/*
  Warnings:

  - Added the required column `countryId` to the `City` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "City" ADD COLUMN     "countryId" INTEGER NOT NULL;

-- CreateTable
CREATE TABLE "Country" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isoCode" TEXT NOT NULL,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Airport" (
    "id" SERIAL NOT NULL,
    "iataCode" TEXT NOT NULL,
    "icaoCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cityId" INTEGER NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "timezone" TEXT NOT NULL,

    CONSTRAINT "Airport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Airline" (
    "id" SERIAL NOT NULL,
    "iataCode" TEXT NOT NULL,
    "icaoCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Airline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightDefinition" (
    "id" SERIAL NOT NULL,
    "airlineId" INTEGER NOT NULL,
    "flightNumber" TEXT NOT NULL,
    "originAirportId" INTEGER NOT NULL,
    "destinationAirportId" INTEGER NOT NULL,
    "basePriceEUR" DOUBLE PRECISION NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "stops" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FlightDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlightInstance" (
    "id" SERIAL NOT NULL,
    "flightDefinitionId" INTEGER NOT NULL,
    "departureDatetime" TIMESTAMP(3) NOT NULL,
    "arrivalDatetime" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "aircraft" TEXT,
    "gate" TEXT,

    CONSTRAINT "FlightInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hotel" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "cityId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Hotel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomType" (
    "id" SERIAL NOT NULL,
    "hotelId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "maxGuests" INTEGER NOT NULL,
    "beds" INTEGER NOT NULL,
    "basePrice" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',

    CONSTRAINT "RoomType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Availability" (
    "id" SERIAL NOT NULL,
    "roomTypeId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "roomsAvailable" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',

    CONSTRAINT "Availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Amenity" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Amenity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HotelAmenity" (
    "hotelId" INTEGER NOT NULL,
    "amenityId" INTEGER NOT NULL,

    CONSTRAINT "HotelAmenity_pkey" PRIMARY KEY ("hotelId","amenityId")
);

-- CreateTable
CREATE TABLE "CancellationPolicy" (
    "id" SERIAL NOT NULL,
    "hotelId" INTEGER NOT NULL,
    "freeCancellation" BOOLEAN NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "CancellationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Country_isoCode_key" ON "Country"("isoCode");

-- CreateIndex
CREATE UNIQUE INDEX "Airport_iataCode_key" ON "Airport"("iataCode");

-- CreateIndex
CREATE UNIQUE INDEX "Airport_icaoCode_key" ON "Airport"("icaoCode");

-- CreateIndex
CREATE UNIQUE INDEX "Airline_iataCode_key" ON "Airline"("iataCode");

-- CreateIndex
CREATE UNIQUE INDEX "Airline_icaoCode_key" ON "Airline"("icaoCode");

-- CreateIndex
CREATE UNIQUE INDEX "FlightDefinition_airlineId_flightNumber_key" ON "FlightDefinition"("airlineId", "flightNumber");

-- CreateIndex
CREATE INDEX "FlightInstance_departureDatetime_idx" ON "FlightInstance"("departureDatetime");

-- CreateIndex
CREATE UNIQUE INDEX "FlightInstance_flightDefinitionId_departureDatetime_key" ON "FlightInstance"("flightDefinitionId", "departureDatetime");

-- CreateIndex
CREATE INDEX "Hotel_cityId_idx" ON "Hotel"("cityId");

-- CreateIndex
CREATE UNIQUE INDEX "Hotel_cityId_name_key" ON "Hotel"("cityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RoomType_hotelId_name_key" ON "RoomType"("hotelId", "name");

-- CreateIndex
CREATE INDEX "Availability_date_idx" ON "Availability"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Availability_roomTypeId_date_key" ON "Availability"("roomTypeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Amenity_name_key" ON "Amenity"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CancellationPolicy_hotelId_key" ON "CancellationPolicy"("hotelId");

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Airport" ADD CONSTRAINT "Airport_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightDefinition" ADD CONSTRAINT "FlightDefinition_airlineId_fkey" FOREIGN KEY ("airlineId") REFERENCES "Airline"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightDefinition" ADD CONSTRAINT "FlightDefinition_originAirportId_fkey" FOREIGN KEY ("originAirportId") REFERENCES "Airport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightDefinition" ADD CONSTRAINT "FlightDefinition_destinationAirportId_fkey" FOREIGN KEY ("destinationAirportId") REFERENCES "Airport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlightInstance" ADD CONSTRAINT "FlightInstance_flightDefinitionId_fkey" FOREIGN KEY ("flightDefinitionId") REFERENCES "FlightDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hotel" ADD CONSTRAINT "Hotel_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomType" ADD CONSTRAINT "RoomType_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Availability" ADD CONSTRAINT "Availability_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotelAmenity" ADD CONSTRAINT "HotelAmenity_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotelAmenity" ADD CONSTRAINT "HotelAmenity_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "Amenity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CancellationPolicy" ADD CONSTRAINT "CancellationPolicy_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
