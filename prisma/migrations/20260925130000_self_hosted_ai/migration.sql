-- Optional media providers are disabled in the current GameVortex build.
-- Keep this historical migration safe for fresh databases where the enum may not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiMediaProvider') THEN
    ALTER TYPE "AiMediaProvider" ADD VALUE IF NOT EXISTS 'SELF_HOSTED';
  END IF;
END $$;
