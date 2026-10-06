-- CreateEnum
CREATE TYPE "BillKind" AS ENUM ('SALE', 'DEPOSIT');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('BOOKED', 'CHECKED_IN', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DepositOutcome" AS ENUM ('USED', 'FORFEITED', 'REFUNDED');

-- AlterEnum
ALTER TYPE "LineType" ADD VALUE 'DEPOSIT';

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'DEPOSIT';

-- AlterTable
ALTER TABLE "Setting" ADD COLUMN     "bookingHoldMin" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "bookingNoShowMin" INTEGER NOT NULL DEFAULT 15;

-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "bookingId" TEXT,
ADD COLUMN     "kind" "BillKind" NOT NULL DEFAULT 'SALE',
ADD COLUMN     "memberFnbDiscountPct" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "memberId" TEXT,
ADD COLUMN     "memberLevelName" TEXT,
ADD COLUMN     "memberName" TEXT,
ADD COLUMN     "memberTimeDiscountPct" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MemberLevel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timeDiscountPct" INTEGER NOT NULL DEFAULT 0,
    "fnbDiscountPct" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "levelId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberCounter" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MemberCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "memberId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" "BookingStatus" NOT NULL DEFAULT 'BOOKED',
    "depositAmount" INTEGER NOT NULL DEFAULT 0,
    "depositBillId" TEXT,
    "depositOutcome" "DepositOutcome",
    "depositUsedAmount" INTEGER NOT NULL DEFAULT 0,
    "saleBillId" TEXT,
    "holdNotifiedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberLevel_name_key" ON "MemberLevel"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Member_code_key" ON "Member"("code");

-- CreateIndex
CREATE INDEX "Member_phone_idx" ON "Member"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_depositBillId_key" ON "Booking"("depositBillId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_saleBillId_key" ON "Booking"("saleBillId");

-- CreateIndex
CREATE INDEX "Booking_unitId_startAt_idx" ON "Booking"("unitId", "startAt");

-- CreateIndex
CREATE INDEX "Booking_status_startAt_idx" ON "Booking"("status", "startAt");

-- CreateIndex
CREATE INDEX "Bill_bookingId_idx" ON "Bill"("bookingId");

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "MemberLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

