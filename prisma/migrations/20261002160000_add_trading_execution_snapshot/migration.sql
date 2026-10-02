-- GameVortex AI Trading: bind the exact execution inputs to the immutable owner approval.
-- The application accesses TradingApproval through parameterized SQL.
ALTER TABLE "TradingApproval"
  ADD COLUMN "executionSnapshot" JSONB;

-- Existing approvals cannot be safely reconstructed from historical request data.
-- Keep them valid for audit/history, but require the snapshot for any new guarded execution path.
CREATE INDEX "TradingApproval_executionSnapshot_idx"
  ON "TradingApproval"("id")
  WHERE "executionSnapshot" IS NOT NULL;
