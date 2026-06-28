-- CreateTable
CREATE TABLE "City" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conditions" (
    "id" SERIAL NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Conditions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrentWeather" (
    "id" SERIAL NOT NULL,
    "cityId" INTEGER NOT NULL,
    "tempC" DOUBLE PRECISION NOT NULL,
    "conditionsId" INTEGER NOT NULL,

    CONSTRAINT "CurrentWeather_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Forecast" (
    "id" SERIAL NOT NULL,
    "cityId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "tempCMin" DOUBLE PRECISION NOT NULL,
    "tempCMax" DOUBLE PRECISION NOT NULL,
    "conditionsId" INTEGER NOT NULL,

    CONSTRAINT "Forecast_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "City_name_key" ON "City"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Conditions_description_key" ON "Conditions"("description");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentWeather_cityId_key" ON "CurrentWeather"("cityId");

-- CreateIndex
CREATE INDEX "Forecast_cityId_date_idx" ON "Forecast"("cityId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Forecast_cityId_date_key" ON "Forecast"("cityId", "date");

-- AddForeignKey
ALTER TABLE "CurrentWeather" ADD CONSTRAINT "CurrentWeather_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentWeather" ADD CONSTRAINT "CurrentWeather_conditionsId_fkey" FOREIGN KEY ("conditionsId") REFERENCES "Conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Forecast" ADD CONSTRAINT "Forecast_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Forecast" ADD CONSTRAINT "Forecast_conditionsId_fkey" FOREIGN KEY ("conditionsId") REFERENCES "Conditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
