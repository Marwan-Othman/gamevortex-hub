-- GameVortex independent commerce/community extensions
CREATE TYPE "ProductKind" AS ENUM ('GAME_KEY','GIFT_CARD','TOP_UP','DLC','SUBSCRIPTION','DIGITAL_ITEM');
CREATE TYPE "DeliveryType" AS ENUM ('CODE','ACCOUNT_TOPUP','EXTERNAL_LINK','MANUAL');
CREATE TYPE "VipTier" AS ENUM ('BRONZE','SILVER','GOLD','PLATINUM','DIAMOND','APEX');
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING','QUALIFIED','REWARDED','REJECTED');
CREATE TYPE "RaffleStatus" AS ENUM ('DRAFT','OPEN','DRAWN','CANCELLED');
ALTER TABLE "User" ADD COLUMN "vipTier" "VipTier" NOT NULL DEFAULT 'BRONZE';
ALTER TABLE "User" ADD COLUMN "referralCode" TEXT;
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");
ALTER TABLE "GameProduct" ADD COLUMN "kind" "ProductKind" NOT NULL DEFAULT 'GAME_KEY';
ALTER TABLE "GameProduct" ADD COLUMN "deliveryType" "DeliveryType" NOT NULL DEFAULT 'CODE';
ALTER TABLE "GameProduct" ADD COLUMN "region" TEXT;
ALTER TABLE "GameProduct" ADD COLUMN "country" TEXT;
ALTER TABLE "GameProduct" ADD COLUMN "denominationCents" INTEGER;
ALTER TABLE "GameProduct" ADD COLUMN "provider" TEXT;
ALTER TABLE "GameProduct" ADD COLUMN "redemptionInstructions" TEXT;
ALTER TABLE "GameProduct" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "GameProduct" ADD COLUMN "supplierVerified" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "Referral" (
  "id" TEXT NOT NULL,
  "referrerId" TEXT NOT NULL,
  "referredId" TEXT NOT NULL,
  "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
  "rewardPoints" INTEGER NOT NULL DEFAULT 0,
  "qualifiedAt" TIMESTAMP(3),
  "rewardedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Referral_referredId_key" ON "Referral"("referredId");
CREATE INDEX "Referral_referrerId_status_createdAt_idx" ON "Referral"("referrerId","status","createdAt");
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "Raffle" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "prize" TEXT NOT NULL,
  "ticketCost" INTEGER NOT NULL DEFAULT 0,
  "maxEntries" INTEGER,
  "status" "RaffleStatus" NOT NULL DEFAULT 'DRAFT',
  "drawAt" TIMESTAMP(3),
  "winnerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Raffle_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Raffle_status_drawAt_idx" ON "Raffle"("status","drawAt");
CREATE TABLE "RaffleEntry" (
  "id" TEXT NOT NULL,
  "raffleId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tickets" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RaffleEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RaffleEntry_raffleId_userId_key" ON "RaffleEntry"("raffleId","userId");
CREATE INDEX "RaffleEntry_userId_createdAt_idx" ON "RaffleEntry"("userId","createdAt");
ALTER TABLE "RaffleEntry" ADD CONSTRAINT "RaffleEntry_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaffleEntry" ADD CONSTRAINT "RaffleEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
