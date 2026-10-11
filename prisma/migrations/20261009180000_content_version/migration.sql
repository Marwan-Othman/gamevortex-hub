-- Phase 10: app/game release version shown on the public page and edited from /admin/content.
-- Nullable and idempotent: existing rows are untouched.
ALTER TABLE "Game" ADD COLUMN IF NOT EXISTS "version" TEXT;
ALTER TABLE "App" ADD COLUMN IF NOT EXISTS "version" TEXT;
