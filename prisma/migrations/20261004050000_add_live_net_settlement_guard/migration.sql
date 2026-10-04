-- Persist no new business state here. This migration only adds a durable
-- audit marker so the migration chain records the net-settlement gate.
-- The actual net proceeds are reconciled from immutable provider trade fills
-- immediately before wallet settlement, so stale cached gross proceeds cannot
-- be credited as final wallet value.

CREATE TABLE IF NOT EXISTS "TradingNetSettlementGuard" (
  "id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradingNetSettlementGuard_pkey" PRIMARY KEY ("id")
);

INSERT INTO "TradingNetSettlementGuard" ("id", "version")
VALUES ('gamevortex-live-net-settlement', '1')
ON CONFLICT ("id") DO NOTHING;
