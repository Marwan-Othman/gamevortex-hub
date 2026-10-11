-- PointLedger / PointLedgerType were defined in schema.prisma and used by lib/points.ts
-- but never had a migration, so `prisma migrate deploy` produced a database without them.
-- Written to be idempotent so databases that were already patched with `db push` keep working.
DO $$ BEGIN
  CREATE TYPE "PointLedgerType" AS ENUM ('CREDIT', 'DEBIT', 'REFUND', 'REVERSAL', 'ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PointLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PointLedgerType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PointLedger_idempotencyKey_key" ON "PointLedger"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "PointLedger_userId_createdAt_idx" ON "PointLedger"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "PointLedger_userId_type_createdAt_idx" ON "PointLedger"("userId", "type", "createdAt");
CREATE INDEX IF NOT EXISTS "PointLedger_sourceId_idx" ON "PointLedger"("sourceId");

DO $$ BEGIN
  ALTER TABLE "PointLedger"
    ADD CONSTRAINT "PointLedger_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
