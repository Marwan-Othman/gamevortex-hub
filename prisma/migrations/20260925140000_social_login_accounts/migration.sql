CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE', 'APPLE', 'STEAM');

CREATE TABLE "OAuthAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "AuthProvider" NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "email" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OAuthAccount_provider_providerAccountId_key"
  ON "OAuthAccount"("provider", "providerAccountId");
CREATE INDEX "OAuthAccount_userId_provider_idx"
  ON "OAuthAccount"("userId", "provider");

ALTER TABLE "OAuthAccount"
  ADD CONSTRAINT "OAuthAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
