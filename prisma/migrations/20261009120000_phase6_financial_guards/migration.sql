-- Phase 6: database-level guards for money columns.
-- Constraints are added NOT VALID so existing rows are not rejected; they apply
-- to every new INSERT/UPDATE immediately. Run
--   ALTER TABLE ... VALIDATE CONSTRAINT ...;
-- after reviewing any legacy rows that violate them.
--
-- Wallet.balance and User.points are intentionally NOT constrained: a provider
-- refund of a spent deposit, or a reversal of points that were already spent,
-- is allowed to leave a negative balance (spending paths still require
-- balance >= amount). Everything below must never be negative.

ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_pendingBalance_nonneg" CHECK ("pendingBalance" >= 0) NOT VALID;
ALTER TABLE "OwnerWallet" ADD CONSTRAINT "OwnerWallet_availablePoints_nonneg" CHECK ("availablePoints" >= 0) NOT VALID;
ALTER TABLE "OwnerWallet" ADD CONSTRAINT "OwnerWallet_pendingPoints_nonneg" CHECK ("pendingPoints" >= 0) NOT VALID;
ALTER TABLE "AiCreditBalance" ADD CONSTRAINT "AiCreditBalance_gvcBalance_nonneg" CHECK ("gvcBalance" >= 0) NOT VALID;
