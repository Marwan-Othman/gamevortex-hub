-- Align the legacy TradingAllocation integrity rule with the USD-cash funding model.
-- TradingAllocation.points is retained only for backward-compatible audit/reporting
-- and is now stored as 0 for new allocations. The old > 0 constraint would make
-- every new USD allocation fail at the database layer.
ALTER TABLE "TradingAllocation"
DROP CONSTRAINT IF EXISTS "TradingAllocation_points_positive";
