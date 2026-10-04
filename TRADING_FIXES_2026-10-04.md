# Trading fixes — 2026-10-04

Changed: lib/trading/{live-production-executor,live-exit-settlement,binance-spot-live-adapter,exchange-adapter,live-order-state,opportunity-service}.ts, vercel.json, .env.production.example
Added: lib/trading/{live-slippage,live-sellable-quantity,live-emergency-exit}.ts (+ tests), app/api/admin/trading/live/execute/route.ts, app/api/cron/trading-live-monitor/route.ts, docs/trading/LIVE_EXECUTION_AND_MONITOR.md
Replaced: lib/trading/live-failure-drills.test.ts (now tests the real modules)
Removed: lib/trading/live-production-executor.integration.test.ts (it tested a function defined inside the test file)

Not verified by a full typecheck/build/test run (no network in the authoring environment). Run `npm ci && npm run typecheck && npm test` before deploying.
