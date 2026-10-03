-- GameVortex AI Trading: durable close/reconciliation state for protected exits.
-- This records the exchange-side close and gross realized P/L separately from
-- GameVortex wallet settlement. No wallet balance is mutated by this migration.

ALTER TABLE "TradingLiveOrder"
  ADD COLUMN "settlementStatus" TEXT NOT NULL DEFAULT 'NOT_SETTLED',
  ADD COLUMN "exitProviderOrderId" TEXT,
  ADD COLUMN "exitClientOrderId" TEXT,
  ADD COLUMN "exitPrice" DECIMAL(30,18),
  ADD COLUMN "exitExecutedQty" DECIMAL(30,18),
  ADD COLUMN "exitCumulativeQuoteQty" DECIMAL(30,18),
  ADD COLUMN "realizedPnlUsd" DECIMAL(30,18),
  ADD COLUMN "exchangeClosedAt" TIMESTAMP(3),
  ADD COLUMN "settlementError" TEXT;

ALTER TABLE "TradingLiveOrder"
  ADD CONSTRAINT "TradingLiveOrder_settlementStatus_check" CHECK ("settlementStatus" IN (
    'NOT_SETTLED',
    'EXCHANGE_CLOSED_PENDING_WALLET',
    'SETTLED',
    'BLOCKED'
  ));

CREATE INDEX "TradingLiveOrder_settlementStatus_updatedAt_idx"
  ON "TradingLiveOrder"("settlementStatus", "updatedAt");

CREATE INDEX "TradingLiveOrder_exitProviderOrderId_idx"
  ON "TradingLiveOrder"("exitProviderOrderId");
