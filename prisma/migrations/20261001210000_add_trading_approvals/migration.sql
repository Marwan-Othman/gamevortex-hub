-- GameVortex AI Trading: durable owner approval storage.
-- The application accesses this table through parameterized SQL because approval
-- state is intentionally isolated from the generated Prisma Client contract.
CREATE TABLE "TradingApproval" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "amountUsd" DECIMAL(18,2) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "strategyVersion" TEXT,
    "shariahStatus" TEXT NOT NULL,
    "riskSnapshot" JSONB,
    "tokenHash" TEXT NOT NULL,

    CONSTRAINT "TradingApproval_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TradingApproval_amountUsd_check" CHECK ("amountUsd" >= 1),
    CONSTRAINT "TradingApproval_status_check" CHECK ("status" IN ('PENDING', 'CONSUMED', 'EXPIRED', 'REJECTED')),
    CONSTRAINT "TradingApproval_shariahStatus_check" CHECK ("shariahStatus" = 'APPROVED'),
    CONSTRAINT "TradingApproval_tokenHash_key" UNIQUE ("tokenHash"),
    CONSTRAINT "TradingApproval_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "TradingApproval_ownerId_issuedAt_idx" ON "TradingApproval"("ownerId", "issuedAt");
CREATE INDEX "TradingApproval_opportunityId_issuedAt_idx" ON "TradingApproval"("opportunityId", "issuedAt");
CREATE INDEX "TradingApproval_status_expiresAt_idx" ON "TradingApproval"("status", "expiresAt");
