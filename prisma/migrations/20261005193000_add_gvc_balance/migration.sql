ALTER TABLE "AiCreditBalance"
ADD COLUMN "gvcBalance" INTEGER NOT NULL DEFAULT 0;

UPDATE "AiCreditBalance"
SET "gvcBalance" = "chatCredits" + "imageCredits" + "videoCredits";

CREATE INDEX "AiCreditBalance_gvcBalance_idx" ON "AiCreditBalance"("gvcBalance");
