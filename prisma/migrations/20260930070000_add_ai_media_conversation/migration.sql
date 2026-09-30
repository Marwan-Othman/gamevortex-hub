ALTER TABLE "AiMediaJob"
ADD COLUMN IF NOT EXISTS "conversationId" TEXT;

CREATE INDEX IF NOT EXISTS "AiMediaJob_conversationId_createdAt_idx"
ON "AiMediaJob"("conversationId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AiMediaJob_conversationId_fkey'
  ) THEN
    ALTER TABLE "AiMediaJob"
      ADD CONSTRAINT "AiMediaJob_conversationId_fkey"
      FOREIGN KEY ("conversationId")
      REFERENCES "GameVortexAiConversation"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
