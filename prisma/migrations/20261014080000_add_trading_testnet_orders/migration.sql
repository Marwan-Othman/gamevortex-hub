-- Durable idempotency for Binance Spot Testnet BUY attempts.
-- This table is intentionally separate from TradingLiveOrder: testnet records
-- must never be mistaken for production orders or enter live settlement.
CREATE TABLE "TradingTestnetOrder" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "clientOrderId" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "symbol" TEXT NOT NULL,
    "amountUsd" DECIMAL(18,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INTENT_CREATED',
    "lastError" TEXT,
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradingTestnetOrder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TradingTestnetOrder_amountUsd_check" CHECK ("amountUsd" >= 1),
    CONSTRAINT "TradingTestnetOrder_status_check" CHECK ("status" IN ('INTENT_CREATED', 'SUBMITTING', 'UNKNOWN', 'FILLED', 'REJECTED')),
    CONSTRAINT "TradingTestnetOrder_idempotencyKey_key" UNIQUE ("idempotencyKey"),
    CONSTRAINT "TradingTestnetOrder_approvalId_key" UNIQUE ("approvalId"),
    CONSTRAINT "TradingTestnetOrder_clientOrderId_key" UNIQUE ("clientOrderId"),
    CONSTRAINT "TradingTestnetOrder_providerOrderId_key" UNIQUE ("providerOrderId"),
    CONSTRAINT "TradingTestnetOrder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TradingTestnetOrder_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "TradingApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "TradingTestnetOrder_ownerId_createdAt_idx" ON "TradingTestnetOrder"("ownerId", "createdAt");
CREATE INDEX "TradingTestnetOrder_status_updatedAt_idx" ON "TradingTestnetOrder"("status", "updatedAt");
