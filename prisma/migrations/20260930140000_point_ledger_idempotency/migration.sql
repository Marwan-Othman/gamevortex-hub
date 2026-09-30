CREATE TABLE "RaffleEntryRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "raffleEntryId" TEXT NOT NULL,
    "tickets" INTEGER NOT NULL,
    "pointsCharged" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RaffleEntryRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RaffleEntryRequest_idempotencyKey_key" ON "RaffleEntryRequest"("idempotencyKey");
CREATE INDEX "RaffleEntryRequest_userId_createdAt_idx" ON "RaffleEntryRequest"("userId", "createdAt");
CREATE INDEX "RaffleEntryRequest_raffleId_createdAt_idx" ON "RaffleEntryRequest"("raffleId", "createdAt");

ALTER TABLE "RaffleEntryRequest"
  ADD CONSTRAINT "RaffleEntryRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RaffleEntryRequest"
  ADD CONSTRAINT "RaffleEntryRequest_raffleId_fkey"
  FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RaffleEntryRequest"
  ADD CONSTRAINT "RaffleEntryRequest_raffleEntryId_fkey"
  FOREIGN KEY ("raffleEntryId") REFERENCES "RaffleEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;