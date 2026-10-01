-- GameVortex AI Trading (Owner Edition) — Phase 2b:
-- Shariah audit log (append-only), Trading control (Emergency Stop / Circuit Breaker),
-- and the Shariah Policy v1.0 seed (INACTIVE, not reviewed).

CREATE TABLE "ShariahAuditLog" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT,
  "policyId" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "status" "ShariahStatus" NOT NULL,
  "reasons" TEXT[],
  "input" JSONB NOT NULL,
  "source" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShariahAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradingControl" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "emergencyStopped" BOOLEAN NOT NULL DEFAULT false,
  "emergencyStoppedAt" TIMESTAMP(3),
  "emergencyReason" TEXT,
  "circuitBreakerReasons" TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradingControl_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShariahAuditLog_symbol_createdAt_idx" ON "ShariahAuditLog"("symbol", "createdAt");
CREATE INDEX "ShariahAuditLog_policyId_createdAt_idx" ON "ShariahAuditLog"("policyId", "createdAt");
CREATE INDEX "ShariahAuditLog_status_createdAt_idx" ON "ShariahAuditLog"("status", "createdAt");
CREATE UNIQUE INDEX "TradingControl_ownerId_key" ON "TradingControl"("ownerId");

ALTER TABLE "ShariahAuditLog"
  ADD CONSTRAINT "ShariahAuditLog_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShariahAuditLog"
  ADD CONSTRAINT "ShariahAuditLog_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "ShariahPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TradingControl"
  ADD CONSTRAINT "TradingControl_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ShariahAuditLog is append-only: no UPDATE / DELETE, ever.
CREATE OR REPLACE FUNCTION shariah_audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ShariahAuditLog rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ShariahAuditLog_no_update_delete"
BEFORE UPDATE OR DELETE ON "ShariahAuditLog"
FOR EACH ROW EXECUTE FUNCTION shariah_audit_log_immutable();

-- Shariah Policy v1.0 seed: INACTIVE and NOT reviewed (reviewedAt = NULL).
-- No financial ratio thresholds are seeded on purpose: those are decisions for
-- a qualified Islamic-finance reviewer, not for this code.
INSERT INTO "ShariahPolicy" ("id", "version", "status", "description", "source", "notes", "reviewedAt", "updatedAt")
VALUES (
  'shariah_policy_v1_0',
  'v1.0',
  'INACTIVE',
  'GameVortex AI Trading Shariah Policy v1.0 (draft, awaiting qualified review)',
  'GameVortex internal draft',
  'Not reviewed by a qualified Islamic-finance specialist. No trade may be approved under this policy until it is reviewed and activated.',
  NULL,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "ShariahRule" ("id", "policyId", "ruleKey", "name", "description", "status", "source", "updatedAt")
VALUES
  ('shariah_rule_v1_0_business_screen', 'shariah_policy_v1_0', 'BUSINESS_SCREEN', 'Business Activity Screening',
   'Reject assets tied to prohibited business activities; unknown activity goes to REVIEW.', 'ACTIVE', 'GameVortex internal draft', CURRENT_TIMESTAMP),
  ('shariah_rule_v1_0_trading_method', 'shariah_policy_v1_0', 'TRADING_METHOD', 'Trading Method Screening',
   'Only explicitly allowed methods (spot) pass; margin, leverage, short, futures, options and unknown methods do not.', 'ACTIVE', 'GameVortex internal draft', CURRENT_TIMESTAMP),
  ('shariah_rule_v1_0_financial_screen', 'shariah_policy_v1_0', 'FINANCIAL_SCREEN', 'Financial Screening',
   'Financial ratio thresholds to be defined by the qualified reviewer; until then the result is REVIEW.', 'ACTIVE', 'GameVortex internal draft', CURRENT_TIMESTAMP),
  ('shariah_rule_v1_0_ownership_settlement', 'shariah_policy_v1_0', 'OWNERSHIP_SETTLEMENT', 'Ownership / Settlement Check',
   'Ownership and settlement must be verified for the asset type; otherwise REVIEW.', 'ACTIVE', 'GameVortex internal draft', CURRENT_TIMESTAMP)
ON CONFLICT ("policyId", "ruleKey") DO NOTHING;
