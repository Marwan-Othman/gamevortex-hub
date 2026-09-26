-- New first-party conversation store; prior generic conversations are retained for unrelated features.
CREATE TABLE "GameVortexAiConversation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" VARCHAR(100) NOT NULL DEFAULT 'New conversation',
  "systemInstructions" VARCHAR(2000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GameVortexAiConversation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "GameVortexAiMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "role" VARCHAR(16) NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameVortexAiMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GameVortexAiConversation_userId_updatedAt_idx" ON "GameVortexAiConversation"("userId", "updatedAt");
CREATE INDEX "GameVortexAiMessage_conversationId_createdAt_idx" ON "GameVortexAiMessage"("conversationId", "createdAt");
ALTER TABLE "GameVortexAiConversation" ADD CONSTRAINT "GameVortexAiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameVortexAiMessage" ADD CONSTRAINT "GameVortexAiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "GameVortexAiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Remove old AI media, metering, and service configuration storage.
DROP TABLE IF EXISTS "AiMediaJob";
DROP TABLE IF EXISTS "AiCreditBalance";
DROP TABLE IF EXISTS "AiUsage";
DROP TABLE IF EXISTS "AiServiceSettings";
DROP TYPE IF EXISTS "AiMediaKind";
DROP TYPE IF EXISTS "AiMediaJobStatus";
DROP TYPE IF EXISTS "AiMediaProvider";
DROP TYPE IF EXISTS "AiUsageType";
DROP TYPE IF EXISTS "AiUsageStatus";
DROP TYPE IF EXISTS "AiCreditKind";

ALTER TABLE "VipPlan" DROP COLUMN IF EXISTS "chatCredits", DROP COLUMN IF EXISTS "imageCredits", DROP COLUMN IF EXISTS "videoCredits";
ALTER TABLE "VipSubscription" DROP COLUMN IF EXISTS "chatCredits", DROP COLUMN IF EXISTS "imageCredits", DROP COLUMN IF EXISTS "videoCredits";
ALTER TABLE "VipReward" DROP COLUMN IF EXISTS "chatCredits", DROP COLUMN IF EXISTS "imageCredits", DROP COLUMN IF EXISTS "videoCredits";
ALTER TABLE "VipRewardClaim" DROP COLUMN IF EXISTS "chatCredits", DROP COLUMN IF EXISTS "imageCredits", DROP COLUMN IF EXISTS "videoCredits";
