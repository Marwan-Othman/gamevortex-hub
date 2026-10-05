-- CreateEnum
CREATE TYPE "AiUsageStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'STOPPED', 'CANCELLED');

-- CreateTable
CREATE TABLE "AiUsageLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "requestId" TEXT,
    "taskId" TEXT,
    "operation" TEXT NOT NULL,
    "status" "AiUsageStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "gvcReserved" INTEGER NOT NULL DEFAULT 0,
    "gvcUsed" INTEGER NOT NULL DEFAULT 0,
    "gvcRefunded" INTEGER NOT NULL DEFAULT 0,
    "providerCost" DECIMAL(18,8),
    "errorCode" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsageLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageLedger_idempotencyKey_key" ON "AiUsageLedger"("idempotencyKey");
CREATE INDEX "AiUsageLedger_userId_createdAt_idx" ON "AiUsageLedger"("userId", "createdAt");
CREATE INDEX "AiUsageLedger_provider_status_createdAt_idx" ON "AiUsageLedger"("provider", "status", "createdAt");
CREATE INDEX "AiUsageLedger_taskId_idx" ON "AiUsageLedger"("taskId");
CREATE INDEX "AiUsageLedger_requestId_idx" ON "AiUsageLedger"("requestId");

-- AddForeignKey
ALTER TABLE "AiUsageLedger" ADD CONSTRAINT "AiUsageLedger_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
