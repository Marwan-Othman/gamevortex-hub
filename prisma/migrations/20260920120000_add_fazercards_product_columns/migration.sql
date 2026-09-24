-- FazerCards supplier reference columns on GameProduct (idempotent)
ALTER TABLE "GameProduct" ADD COLUMN IF NOT EXISTS "fazerCategoryId" TEXT;
ALTER TABLE "GameProduct" ADD COLUMN IF NOT EXISTS "fazerCardId" TEXT;
