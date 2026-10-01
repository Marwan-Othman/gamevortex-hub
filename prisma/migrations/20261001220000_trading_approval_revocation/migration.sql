-- GameVortex AI Trading: distinguish owner-revoked approvals from rejected ones.
-- Existing rows remain valid; only the allowed status set is expanded.
ALTER TABLE "TradingApproval"
  DROP CONSTRAINT IF EXISTS "TradingApproval_status_check";

ALTER TABLE "TradingApproval"
  ADD CONSTRAINT "TradingApproval_status_check"
  CHECK ("status" IN ('PENDING', 'CONSUMED', 'EXPIRED', 'REJECTED', 'REVOKED'));
