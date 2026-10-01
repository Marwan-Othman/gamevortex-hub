CREATE TABLE "GameVortexApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "prefix" VARCHAR(24) NOT NULL,
    "secretHash" VARCHAR(64) NOT NULL,
    "requiresPurchase" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "GameVortexApiKey_pkey" PRIMARY KEY ("id")
);

CREATE TYPE "ApiAccessPurchaseStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED');

CREATE TABLE "ApiAccessPurchase" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL DEFAULT 1000,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "status" "ApiAccessPurchaseStatus" NOT NULL DEFAULT 'PENDING',
  "provider" TEXT,
  "providerPaymentId" TEXT,
  "providerCheckoutUrl" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ApiAccessPurchase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GameVortexApiRequestLog" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "route" VARCHAR(100) NOT NULL,
    "status" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameVortexApiRequestLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameVortexApiKey_secretHash_key" ON "GameVortexApiKey"("secretHash");
CREATE UNIQUE INDEX "ApiAccessPurchase_idempotencyKey_key" ON "ApiAccessPurchase"("idempotencyKey");
CREATE UNIQUE INDEX "ApiAccessPurchase_provider_providerPaymentId_key" ON "ApiAccessPurchase"("provider", "providerPaymentId");
CREATE INDEX "ApiAccessPurchase_userId_status_createdAt_idx" ON "ApiAccessPurchase"("userId", "status", "createdAt");
CREATE INDEX "GameVortexApiKey_userId_revokedAt_createdAt_idx" ON "GameVortexApiKey"("userId", "revokedAt", "createdAt");
CREATE INDEX "GameVortexApiRequestLog_apiKeyId_createdAt_idx" ON "GameVortexApiRequestLog"("apiKeyId", "createdAt");
CREATE INDEX "GameVortexApiRequestLog_createdAt_idx" ON "GameVortexApiRequestLog"("createdAt");

ALTER TABLE "GameVortexApiKey"
  ADD CONSTRAINT "GameVortexApiKey_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GameVortexApiRequestLog"
  ADD CONSTRAINT "GameVortexApiRequestLog_apiKeyId_fkey"
  FOREIGN KEY ("apiKeyId") REFERENCES "GameVortexApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApiAccessPurchase"
  ADD CONSTRAINT "ApiAccessPurchase_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;