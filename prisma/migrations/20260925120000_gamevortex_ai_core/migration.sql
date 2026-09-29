-- GameVortex AI balances, usage reservations and owner-controlled availability.
DO $$ BEGIN
  CREATE TYPE "AiUsageStatus" AS ENUM ('RESERVED', 'SUCCEEDED', 'REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AiCreditKind" AS ENUM ('CHAT', 'IMAGE', 'VIDEO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiMediaProvider') THEN
    ALTER TYPE "AiMediaProvider" ADD VALUE IF NOT EXISTS 'OPENAI';
  END IF;
END $$;

ALTER TABLE "AiUsage"
  ADD COLUMN IF NOT EXISTS "status" "AiUsageStatus" NOT NULL DEFAULT 'SUCCEEDED',
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'FREE';

CREATE INDEX IF NOT EXISTS "AiUsage_status_createdAt_idx"
  ON "AiUsage"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "AiCreditBalance" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "AiCreditKind" NOT NULL,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCreditBalance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AiCreditBalance_userId_kind_key"
  ON "AiCreditBalance"("userId", "kind");
CREATE INDEX IF NOT EXISTS "AiCreditBalance_kind_balance_idx"
  ON "AiCreditBalance"("kind", "balance");
DO $$ BEGIN
  ALTER TABLE "AiCreditBalance" ADD CONSTRAINT "AiCreditBalance_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "AiServiceSettings" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "chatEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "imageEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "videoEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "freeChatCredits" INTEGER NOT NULL DEFAULT 450,
  "freeImageCredits" INTEGER NOT NULL DEFAULT 38,
  "freeVideoCredits" INTEGER NOT NULL DEFAULT 5,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiServiceSettings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AiServiceSettings_singleton_check" CHECK ("id" = 1)
);
INSERT INTO "AiServiceSettings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "AiMediaJob"
  ADD COLUMN IF NOT EXISTS "resultBytes" BYTEA,
  ADD COLUMN IF NOT EXISTS "contentType" TEXT,
  ADD COLUMN IF NOT EXISTS "inputImageUrl" TEXT;

ALTER TABLE "AiCreditBalance"
  ADD COLUMN IF NOT EXISTS "resetAt" TIMESTAMP(3);
