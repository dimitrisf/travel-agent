-- AlterTable
ALTER TABLE "FlightDefinition" ADD COLUMN     "externalSource" TEXT DEFAULT 'seed',
ADD COLUMN     "generatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "FlightInstance" ADD COLUMN     "externalSource" TEXT DEFAULT 'seed',
ADD COLUMN     "generatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Hotel" ADD COLUMN     "externalSource" TEXT DEFAULT 'seed',
ADD COLUMN     "generatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RoomType" ADD COLUMN     "externalSource" TEXT DEFAULT 'seed',
ADD COLUMN     "generatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "FlightDefinition_externalSource_idx" ON "FlightDefinition"("externalSource");

-- CreateIndex
CREATE INDEX "FlightInstance_externalSource_idx" ON "FlightInstance"("externalSource");

-- CreateIndex
CREATE INDEX "Hotel_externalSource_idx" ON "Hotel"("externalSource");

-- CreateIndex
CREATE INDEX "RoomType_externalSource_idx" ON "RoomType"("externalSource");
