-- GameVortex AI Trading (Owner Edition) — Phase 2: Trading Wallet Allocation

-- AlterEnum
ALTER TYPE "LedgerType" ADD VALUE 'TRADING_ALLOCATED';
ALTER TYPE "LedgerType" ADD VALUE 'TRADING_RETURNED';

-- CreateEnum
CREATE TYPE "TradingAllocationStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- CreateEnum
CREATE TYPE "TradingLedgerType" AS ENUM ('ALLOCATION_IN', 'ALLOCATION_RETURN');

-- CreateTable
CREATE TABLE "TradingAccount" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "balanceUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingAllocation" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "sourceWalletId" TEXT NOT NULL,
  "amountUsd" INTEGER NOT NULL,
  "points" INTEGER NOT NULL,
  "conversionRate" INTEGER NOT NULL,
  "status" "TradingAllocationStatus" NOT NULL DEFAULT 'ACTIVE',
  "idempotencyKey" TEXT NOT NULL,
  "relatedTradeId" TEXT,
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradingAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingLedger" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "allocationId" TEXT,
  "type" "TradingLedgerType" NOT NULL,
  "amountUsd" DECIMAL(18,8) NOT NULL,
  "balanceBeforeUsd" DECIMAL(18,8) NOT NULL,
  "balanceAfterUsd" DECIMAL(18,8) NOT NULL,
  "relatedTradeId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'POSTED',
  "idempotencyKey" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradingLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradingAccount_ownerId_key" ON "TradingAccount"("ownerId");
CREATE UNIQUE INDEX "TradingAllocation_idempotencyKey_key" ON "TradingAllocation"("idempotencyKey");
CREATE INDEX "TradingAllocation_accountId_status_idx" ON "TradingAllocation"("accountId", "status");
CREATE INDEX "TradingAllocation_sourceWalletId_idx" ON "TradingAllocation"("sourceWalletId");
CREATE UNIQUE INDEX "TradingLedger_idempotencyKey_key" ON "TradingLedger"("idempotencyKey");
CREATE INDEX "TradingLedger_accountId_createdAt_idx" ON "TradingLedger"("accountId", "createdAt");
CREATE INDEX "TradingLedger_allocationId_idx" ON "TradingLedger"("allocationId");

-- AddForeignKey
ALTER TABLE "TradingAccount" ADD CONSTRAINT "TradingAccount_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradingAllocation" ADD CONSTRAINT "TradingAllocation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradingAllocation" ADD CONSTRAINT "TradingAllocation_sourceWalletId_fkey" FOREIGN KEY ("sourceWalletId") REFERENCES "OwnerWallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradingLedger" ADD CONSTRAINT "TradingLedger_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TradingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TradingLedger" ADD CONSTRAINT "TradingLedger_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "TradingAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Integrity rules (not expressible in Prisma schema)
ALTER TABLE "TradingAccount" ADD CONSTRAINT "TradingAccount_balance_nonnegative" CHECK ("balanceUsd" >= 0);
ALTER TABLE "TradingAllocation" ADD CONSTRAINT "TradingAllocation_amount_min_1" CHECK ("amountUsd" >= 1);
ALTER TABLE "TradingAllocation" ADD CONSTRAINT "TradingAllocation_points_positive" CHECK ("points" > 0);

-- TradingLedger is append-only: no UPDATE / DELETE, ever (Task 91).
CREATE OR REPLACE FUNCTION trading_ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TradingLedger rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TradingLedger_no_update_delete"
BEFORE UPDATE OR DELETE ON "TradingLedger"
FOR EACH ROW EXECUTE FUNCTION trading_ledger_immutable();
