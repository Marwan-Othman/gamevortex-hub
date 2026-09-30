-- Replace external media provider enum values with the internal GameVortex runtime marker.
-- Existing jobs are retained and normalized to INTERNAL because no external provider
-- integration remains in the application.

ALTER TYPE "AiMediaProvider" RENAME TO "AiMediaProvider_old";

CREATE TYPE "AiMediaProvider" AS ENUM ('INTERNAL');

ALTER TABLE "AiMediaJob"
  ALTER COLUMN "provider" TYPE "AiMediaProvider"
  USING 'INTERNAL'::"AiMediaProvider";

DROP TYPE "AiMediaProvider_old";
