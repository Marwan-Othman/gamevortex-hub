-- Item 33 (Monitoring / Error Handling): persisted system error log so that
-- unhandled failures in critical paths (payments, checkout, withdrawals, AI,
-- client-side crashes) survive past the serverless function's own console
-- logs and can be reviewed from /admin/errors.
CREATE TABLE "SystemError" (
  "id" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "statusCode" INTEGER,
  "userId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id")
);
CREATE INDEX "SystemError_scope_createdAt_idx" ON "SystemError" ("scope", "createdAt");
CREATE INDEX "SystemError_createdAt_idx" ON "SystemError" ("createdAt");
