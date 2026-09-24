-- GameVortex V10: invalidate old sessions on security events and bind owner identity.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1;
