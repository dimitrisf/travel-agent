-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "userId" TEXT,
ALTER COLUMN "customerName" DROP NOT NULL,
ALTER COLUMN "customerEmail" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Booking_userId_idx" ON "Booking"("userId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
