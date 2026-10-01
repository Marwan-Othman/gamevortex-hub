-- GameVortex AI Trading — Owner Approval persistence
-- Stores only the approval-token hash. Plaintext approval tokens never enter the database.

CREATE TABLE "TradingApproval" (
  "id" TEXT NOT NULL,
  "opportunityId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "amountUsd" DECIMAL(18,8) NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "strategyVersion" TEXT,
  "shariahStatus" TEXT NOT NULL,
  "riskSnapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradingApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TradingApproval_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TradingApproval_status_check" CHECK ("status" IN ('PENDING', 'CONSUMED', 'EXPIRED', 'REVOKED')),
  CONSTRAINT "TradingApproval_amount_check" CHECK ("amountUsd" >= 1),
  CONSTRAINT "TradingApproval_expiry_check" CHECK ("expiresAt" > "issuedAt")
);

CREATE UNIQUE INDEX "TradingApproval_tokenHash_key" ON "TradingApproval"("tokenHash");
CREATE INDEX "TradingApproval_ownerId_status_expiresAt_idx" ON "TradingApproval"("ownerId", "status", "expiresAt");
CREATE INDEX "TradingApproval_opportunityId_createdAt_idx" ON "TradingApproval"("opportunityId", "createdAt");
CREATE INDEX "TradingApproval_expiresAt_status_idx" ON "TradingApproval"("expiresAt", "status");
