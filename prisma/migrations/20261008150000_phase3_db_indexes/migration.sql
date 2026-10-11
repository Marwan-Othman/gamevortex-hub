-- Phase 3 hardening: indexes for hot read paths that were previously unindexed.
-- Matches the @@index declarations added to schema.prisma (Game, WithdrawalRequest, OwnerLedger).
-- Additive only: no data is changed and no constraints are added.

CREATE INDEX "Game_published_featured_idx"
  ON "Game"("published", "featured");

CREATE INDEX "WithdrawalRequest_ownerWalletId_status_createdAt_idx"
  ON "WithdrawalRequest"("ownerWalletId", "status", "createdAt");

CREATE INDEX "OwnerLedger_walletId_createdAt_idx"
  ON "OwnerLedger"("walletId", "createdAt");

CREATE INDEX "OwnerLedger_withdrawalId_idx"
  ON "OwnerLedger"("withdrawalId");
