-- Add encrypted digital-key inventory and delivery tracking for GAME_KEY products.
CREATE TYPE "DigitalKeyStatus" AS ENUM ('AVAILABLE', 'DELIVERED', 'REVOKED');

CREATE TABLE "DigitalKey" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "ciphertext" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "DigitalKeyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "deliveredAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DigitalKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DigitalKey_fingerprint_key" ON "DigitalKey"("fingerprint");
CREATE INDEX "DigitalKey_productId_status_createdAt_idx" ON "DigitalKey"("productId", "status", "createdAt");
CREATE INDEX "DigitalKey_orderItemId_status_idx" ON "DigitalKey"("orderItemId", "status");

ALTER TABLE "DigitalKey"
  ADD CONSTRAINT "DigitalKey_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "GameProduct"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DigitalKey"
  ADD CONSTRAINT "DigitalKey_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
