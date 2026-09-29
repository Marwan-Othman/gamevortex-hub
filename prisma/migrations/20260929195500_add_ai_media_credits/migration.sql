CREATE TYPE "AiMediaKind" AS ENUM ('IMAGE', 'VIDEO');
CREATE TYPE "AiMediaJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "AiMediaProvider" AS ENUM ('FAL', 'MINIMAX');
CREATE TYPE "AiCreditKind" AS ENUM ('CHAT', 'IMAGE', 'VIDEO');

CREATE TABLE "AiMediaJob" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "AiMediaKind" NOT NULL,
  "provider" "AiMediaProvider" NOT NULL,
  "providerTaskId" TEXT,
  "providerFileId" TEXT,
  "model" TEXT,
  "prompt" TEXT NOT NULL,
  "status" "AiMediaJobStatus" NOT NULL DEFAULT 'QUEUED',
  "resultUrl" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiMediaJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiMediaJob_providerTaskId_key" ON "AiMediaJob"("providerTaskId");
CREATE UNIQUE INDEX "AiMediaJob_idempotencyKey_key" ON "AiMediaJob"("idempotencyKey");
CREATE INDEX "AiMediaJob_userId_createdAt_idx" ON "AiMediaJob"("userId", "createdAt");
CREATE INDEX "AiMediaJob_userId_status_createdAt_idx" ON "AiMediaJob"("userId", "status", "createdAt");
ALTER TABLE "AiMediaJob" ADD CONSTRAINT "AiMediaJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiCreditBalance" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "chatCredits" INTEGER NOT NULL DEFAULT 0,
  "imageCredits" INTEGER NOT NULL DEFAULT 0,
  "videoCredits" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiCreditBalance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiCreditBalance_userId_key" ON "AiCreditBalance"("userId");
ALTER TABLE "AiCreditBalance" ADD CONSTRAINT "AiCreditBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AiCreditLedger" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "AiCreditKind" NOT NULL,
  "delta" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "referenceId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCreditLedger_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AiCreditLedger_idempotencyKey_key" ON "AiCreditLedger"("idempotencyKey");
CREATE INDEX "AiCreditLedger_userId_kind_createdAt_idx" ON "AiCreditLedger"("userId", "kind", "createdAt");
ALTER TABLE "AiCreditLedger" ADD CONSTRAINT "AiCreditLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
