-- GameVortex AI Trading (Owner Edition) — Phase 2: Shariah Guard + Risk Manager

CREATE TYPE "ShariahStatus" AS ENUM ('APPROVED', 'REVIEW', 'REJECTED');
CREATE TYPE "ShariahRuleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "ShariahPolicy" (
  "id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "status" "ShariahRuleStatus" NOT NULL DEFAULT 'ACTIVE',
  "description" TEXT NOT NULL,
  "source" TEXT,
  "notes" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShariahPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShariahRule" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "ruleKey" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "ShariahRuleStatus" NOT NULL DEFAULT 'ACTIVE',
  "source" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShariahRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssetShariahProfile" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "assetType" TEXT NOT NULL,
  "issuer" TEXT,
  "businessActivity" TEXT,
  "status" "ShariahStatus" NOT NULL,
  "reason" TEXT NOT NULL,
  "source" TEXT,
  "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ruleVersion" TEXT NOT NULL,
  "financialRatios" JSONB,
  "tradingMethod" TEXT,
  "ownershipSettlementVerified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AssetShariahProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradingRiskConfig" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "maxTradeAmountUsd" DECIMAL(18,8) NOT NULL,
  "maxDailyLossUsd" DECIMAL(18,8) NOT NULL,
  "maxOpenTrades" INTEGER NOT NULL,
  "maxExposureUsd" DECIMAL(18,8) NOT NULL,
  "maxExposurePerAssetUsd" DECIMAL(18,8) NOT NULL,
  "maxConsecutiveLosses" INTEGER NOT NULL,
  "requireStopLoss" BOOLEAN NOT NULL DEFAULT true,
  "requireTakeProfit" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradingRiskConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShariahPolicy_version_key" ON "ShariahPolicy"("version");
CREATE INDEX "ShariahPolicy_status_createdAt_idx" ON "ShariahPolicy"("status", "createdAt");
CREATE UNIQUE INDEX "ShariahRule_policyId_ruleKey_key" ON "ShariahRule"("policyId", "ruleKey");
CREATE INDEX "ShariahRule_policyId_status_idx" ON "ShariahRule"("policyId", "status");
CREATE UNIQUE INDEX "AssetShariahProfile_symbol_policyId_key" ON "AssetShariahProfile"("symbol", "policyId");
CREATE INDEX "AssetShariahProfile_symbol_status_idx" ON "AssetShariahProfile"("symbol", "status");
CREATE INDEX "AssetShariahProfile_policyId_status_idx" ON "AssetShariahProfile"("policyId", "status");
CREATE UNIQUE INDEX "TradingRiskConfig_ownerId_key" ON "TradingRiskConfig"("ownerId");
CREATE INDEX "TradingRiskConfig_enabled_updatedAt_idx" ON "TradingRiskConfig"("enabled", "updatedAt");

ALTER TABLE "ShariahRule"
  ADD CONSTRAINT "ShariahRule_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "ShariahPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AssetShariahProfile"
  ADD CONSTRAINT "AssetShariahProfile_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "ShariahPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TradingRiskConfig"
  ADD CONSTRAINT "TradingRiskConfig_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TradingRiskConfig"
  ADD CONSTRAINT "TradingRiskConfig_limits_valid"
  CHECK (
    "maxTradeAmountUsd" >= 1 AND
    "maxDailyLossUsd" >= 0 AND
    "maxOpenTrades" > 0 AND
    "maxExposureUsd" >= 0 AND
    "maxExposurePerAssetUsd" >= 0 AND
    "maxConsecutiveLosses" > 0
  );
