-- Align the database created by earlier migrations with the current Prisma schema.
-- The initial migration created legacy scalar placeholders that are superseded by relations.
DROP INDEX "Payment_provider_providerPaymentId_idx";

ALTER TABLE "User"
  DROP COLUMN "gamerProfile",
  DROP COLUMN "ownerWallet",
  DROP COLUMN "wallet";
