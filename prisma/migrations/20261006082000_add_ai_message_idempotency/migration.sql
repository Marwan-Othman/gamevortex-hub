ALTER TABLE "GameVortexAiMessage"
ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "GameVortexAiMessage_idempotencyKey_key"
ON "GameVortexAiMessage"("idempotencyKey");