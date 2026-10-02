-- GameVortex AI Trading: fail-closed protection boundary for filled live orders.
-- A filled BUY must not be considered safely complete until its protective exit
-- orders have been confirmed by the provider.

ALTER TABLE "TradingLiveOrder"
  ADD COLUMN "protectionStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN "protectionOrderId" TEXT,
  ADD COLUMN "stopLossOrderId" TEXT,
  ADD COLUMN "takeProfitOrderId" TEXT,
  ADD COLUMN "protectionUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "protectionError" TEXT;

ALTER TABLE "TradingLiveOrder"
  DROP CONSTRAINT "TradingLiveOrder_status_check";

ALTER TABLE "TradingLiveOrder"
  ADD CONSTRAINT "TradingLiveOrder_status_check" CHECK ("status" IN (
    'INTENT_CREATED',
    'SUBMITTING',
    'SUBMITTED',
    'PARTIALLY_FILLED',
    'FILLED',
    'PROTECTION_PENDING',
    'PROTECTED',
    'PROTECTION_FAILED',
    'CANCELED',
    'REJECTED',
    'EXPIRED',
    'UNKNOWN',
    'RECONCILIATION_MISMATCH',
    'CLOSED'
  ));

ALTER TABLE "TradingLiveOrder"
  ADD CONSTRAINT "TradingLiveOrder_protectionStatus_check" CHECK ("protectionStatus" IN (
    'NOT_REQUIRED',
    'PENDING',
    'PROTECTED',
    'FAILED'
  ));

CREATE INDEX "TradingLiveOrder_protectionStatus_updatedAt_idx"
  ON "TradingLiveOrder"("protectionStatus", "updatedAt");
