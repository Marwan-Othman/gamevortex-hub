CREATE TYPE "AiMediaKind" AS ENUM ('IMAGE', 'VIDEO');
CREATE TYPE "AiMediaJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "AiMediaProvider" AS ENUM ('FAL', 'MINIMAX');

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
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiMediaJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiMediaJob_idempotencyKey_key" ON "AiMediaJob"("idempotencyKey");
CREATE UNIQUE INDEX "AiMediaJob_providerTaskId_key" ON "AiMediaJob"("providerTaskId");
CREATE INDEX "AiMediaJob_userId_createdAt_idx" ON "AiMediaJob"("userId", "createdAt");
CREATE INDEX "AiMediaJob_userId_status_createdAt_idx" ON "AiMediaJob"("userId", "status", "createdAt");

ALTER TABLE "AiMediaJob"
ADD CONSTRAINT "AiMediaJob_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
