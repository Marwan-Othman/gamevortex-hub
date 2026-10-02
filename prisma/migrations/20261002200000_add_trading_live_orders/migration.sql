-- GameVortex AI Trading: durable live-order state and reconciliation boundary.
-- This table stores only normalized order state. It never stores API keys,
-- API secrets, signatures, or withdrawal credentials.
CREATE TABLE "TradingLiveOrder" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "clientOrderId" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL DEFAULT 'BUY',
    "amountUsd" DECIMAL(18,2) NOT NULL,
    "entryPrice" DECIMAL(30,12) NOT NULL,
    "stopLossPrice" DECIMAL(30,12) NOT NULL,
    "takeProfitPrice" DECIMAL(30,12),
    "status" TEXT NOT NULL DEFAULT 'INTENT_CREATED',
    "providerStatus" TEXT,
    "executedQty" DECIMAL(30,18),
    "cumulativeQuoteQty" DECIMAL(30,18),
    "averageFillPrice" DECIMAL(30,18),
    "lastProviderUpdateAt" TIMESTAMP(3),
    "lastReconciledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradingLiveOrder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TradingLiveOrder_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TradingLiveOrder_amountUsd_check" CHECK ("amountUsd" >= 1),
    CONSTRAINT "TradingLiveOrder_side_check" CHECK ("side" = 'BUY'),
    CONSTRAINT "TradingLiveOrder_status_check" CHECK ("status" IN (
        'INTENT_CREATED',
        'SUBMITTING',
        'SUBMITTED',
        'PARTIALLY_FILLED',
        'FILLED',
        'CANCELED',
        'REJECTED',
        'EXPIRED',
        'UNKNOWN',
        'RECONCILIATION_MISMATCH',
        'CLOSED'
    )),
    CONSTRAINT "TradingLiveOrder_idempotencyKey_key" UNIQUE ("idempotencyKey"),
    CONSTRAINT "TradingLiveOrder_clientOrderId_key" UNIQUE ("clientOrderId"),
    CONSTRAINT "TradingLiveOrder_providerOrderId_key" UNIQUE ("providerOrderId")
);

CREATE INDEX "TradingLiveOrder_ownerId_createdAt_idx" ON "TradingLiveOrder"("ownerId", "createdAt");
CREATE INDEX "TradingLiveOrder_status_updatedAt_idx" ON "TradingLiveOrder"("status", "updatedAt");
CREATE INDEX "TradingLiveOrder_approvalId_idx" ON "TradingLiveOrder"("approvalId");
CREATE INDEX "TradingLiveOrder_opportunityId_idx" ON "TradingLiveOrder"("opportunityId");

-- Keep updatedAt database-managed for every state transition.
CREATE OR REPLACE FUNCTION "set_trading_live_order_updated_at"()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TradingLiveOrder_set_updated_at"
BEFORE UPDATE ON "TradingLiveOrder"
FOR EACH ROW
EXECUTE FUNCTION "set_trading_live_order_updated_at"();
