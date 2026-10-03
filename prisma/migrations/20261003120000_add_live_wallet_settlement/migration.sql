-- GameVortex AI Trading: bind each live trade to one owner-wallet allocation
-- and persist the final wallet settlement result.
-- The settlement remains fail-closed and is only performed after exchange-side
-- close reconciliation has confirmed the complete protected exit.

ALTER TABLE "TradingLiveOrder"
  ADD COLUMN "walletSettledAt" TIMESTAMP(3),
  ADD COLUMN "settledUsd" DECIMAL(30,18),
  ADD COLUMN "settledPoints" INTEGER,
  ADD COLUMN "settlementRoundingUsd" DECIMAL(30,18);

CREATE INDEX "TradingLiveOrder_walletSettledAt_idx"
  ON "TradingLiveOrder"("walletSettledAt");

CREATE INDEX "TradingAllocation_relatedTradeId_idx"
  ON "TradingAllocation"("relatedTradeId");

-- One allocation can back at most one live trade. The existing nullable
-- relatedTradeId field is intentionally reused so the allocation remains the
-- single source of truth for the capital that was moved out of Owner Wallet.
CREATE UNIQUE INDEX "TradingAllocation_relatedTradeId_key"
  ON "TradingAllocation"("relatedTradeId")
  WHERE "relatedTradeId" IS NOT NULL;
