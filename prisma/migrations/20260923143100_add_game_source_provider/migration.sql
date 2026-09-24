ALTER TABLE "Game" ADD COLUMN "sourceProvider" TEXT;
CREATE INDEX "Game_sourceProvider_idx" ON "Game"("sourceProvider");
