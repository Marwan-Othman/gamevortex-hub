-- ============================================================
-- GameVortex Hub
-- GameVortex own API — sale + key management
-- Master Task Plan - Section 3 (items 1, 2, 3)
-- ============================================================

DO $$
BEGIN
    CREATE TYPE "ApiKeyPurchaseStatus" AS ENUM (
        'PENDING',
        'PAID',
        'FAILED',
        'REFUNDED'
    );
EXCEPTION
    WHEN duplicate_object THEN
        NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "ApiKeyStatus" AS ENUM (
        'ACTIVE',
        'REVOKED'
    );
EXCEPTION
    WHEN duplicate_object THEN
        NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'GameVortex API Key',
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "plainKeyOnce" TEXT,
    "revealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
CREATE INDEX IF NOT EXISTS "ApiKey_userId_createdAt_idx" ON "ApiKey"("userId", "createdAt");

CREATE TABLE IF NOT EXISTS "ApiKeyPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 1000,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "provider" TEXT,
    "providerPaymentId" TEXT,
    "status" "ApiKeyPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKeyPurchase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ApiKeyPurchase_idempotencyKey_key" ON "ApiKeyPurchase"("idempotencyKey");
CREATE UNIQUE INDEX IF NOT EXISTS "ApiKeyPurchase_apiKeyId_key" ON "ApiKeyPurchase"("apiKeyId");
CREATE INDEX IF NOT EXISTS "ApiKeyPurchase_userId_createdAt_idx" ON "ApiKeyPurchase"("userId", "createdAt");

DO $$
BEGIN
    ALTER TABLE "ApiKey"
        ADD CONSTRAINT "ApiKey_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "ApiKeyPurchase"
        ADD CONSTRAINT "ApiKeyPurchase_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE "ApiKeyPurchase"
        ADD CONSTRAINT "ApiKeyPurchase_apiKeyId_fkey"
        FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
