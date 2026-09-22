-- ============================================================
-- GameVortex Hub
-- Points Withdrawal for VIP / Regular Users
-- Master Task Plan - Section 3 (items 6, 7, 11)
-- ============================================================
--
-- The Owner already withdraws through WithdrawalRequest + OwnerWallet.
-- This table adds the equivalent path for VIP and regular users,
-- withdrawing directly from their PointLedger / User.points balance
-- (via lib/points.ts debitPoints, not this table's own balance).

CREATE TABLE IF NOT EXISTS "UserWithdrawalRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "usdAmount" DECIMAL(18,2) NOT NULL,
    "conversionRate" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "provider" TEXT,
    "providerTransactionId" TEXT,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "failureReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "UserWithdrawalRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserWithdrawalRequest_idempotencyKey_key"
    ON "UserWithdrawalRequest"("idempotencyKey");

CREATE INDEX IF NOT EXISTS "UserWithdrawalRequest_userId_createdAt_idx"
    ON "UserWithdrawalRequest"("userId", "createdAt");

CREATE INDEX IF NOT EXISTS "UserWithdrawalRequest_status_createdAt_idx"
    ON "UserWithdrawalRequest"("status", "createdAt");

DO $$
BEGIN
    ALTER TABLE "UserWithdrawalRequest"
        ADD CONSTRAINT "UserWithdrawalRequest_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN
        NULL;
END $$;
