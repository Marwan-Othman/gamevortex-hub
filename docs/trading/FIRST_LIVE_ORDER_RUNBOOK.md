# First Live Spot Order — Owner Runbook

## Status and safety boundary

This runbook is a release gate, not authorization to trade. Keep `GAMEVORTEX_LIVE_TRADING_ENABLED=false` or unset until every precondition below has been verified on the exact production revision. Never put Binance credentials in source control, chat, client-side variables, or logs.

Scope is Binance Spot only. Withdrawals, margin, leverage, futures, options, short selling, and transfers must remain disabled.

## Gate 1 — code and database verification

- [ ] Record the exact `main` commit SHA and its Vercel Production deployment.
- [ ] Run the complete production validation against that same commit: environment contract, source-integrity checks, Prisma schema validation/generation, migration deployment against a clean disposable PostgreSQL database, all tests, TypeScript typecheck, production build, and smoke checks.
- [ ] Verify the deployed database migration status and confirm there are no pending migrations. Do not infer database state from a successful build.
- [ ] Run executor-level failure drills against a disposable test database: timeout after provider submission, provider rejection, partial fill, stale provider observation, reconciliation mismatch, protective OCO failure, emergency-stop activation, wallet-settlement failure, and settlement retry/idempotency.
- [ ] Confirm no test can reach Binance production or submit a real order.

## Gate 2 — policy and account configuration

- [ ] A qualified Shariah reviewer has independently reviewed the actual policy and asset-screening methodology, documented the decision, and authorized activation. Software tests are not a religious ruling; do not activate the policy on a developer's assumption.
- [ ] The Risk Manager limits, stop-loss/take-profit rules, circuit breaker, and emergency-stop behavior have been reviewed.
- [ ] The Binance API key is restricted to Spot trading only. Withdrawals, margin, futures, options, portfolio margin, and transfers are disabled.
- [ ] The API key and exactly one valid signing credential are stored as Vercel Production secrets. Confirm key type matches the configured secret (HMAC secret or Ed25519 private key).
- [ ] Confirm `CRON_SECRET` is set and the live monitor's authorization works. Verify the monitor reconciles/protects/settles existing orders but cannot create a new BUY.
- [ ] Confirm the emergency-exit and wallet-settlement procedures are understood. Emergency-exit accounting that is not automated must be reconciled manually before any wallet credit.

## Gate 3 — read-only preflight

- [ ] With live trading still disabled, the owner runs `GET /api/admin/trading/exchange/live/preflight` and reviews every diagnostic.
- [ ] Verify the production base URL is Binance production, account/key restrictions match the intended Spot-only scope, and market symbol filters/minimum notional are current.
- [ ] Verify production market data is fresh and the slippage guard is configured. A passing preflight alone does not authorize an order.
- [ ] Confirm the Shariah policy is reviewed/approved in the database and TradingControl emergency-stop and circuit-breaker state are clear.
- [ ] If any check is unavailable, ambiguous, stale, or failing, stop. Do not bypass the guard.

## Gate 4 — controlled first order (requires explicit owner decision)

Do not execute this section automatically or as part of deployment.

- [ ] Owner confirms in the production admin panel that all prior gates passed and explicitly authorizes enabling live execution.
- [ ] Set `GAMEVORTEX_LIVE_TRADING_ENABLED=true` only for the controlled test window, then redeploy through the normal production process.
- [ ] Use the smallest practical amount that also satisfies the selected Binance symbol's current minimum-notional and quantity/price filters. The application minimum is $1, but a particular symbol may require more.
- [ ] Use the normal owner-only flow: prepare the order, inspect the complete risk/policy/price result, consume the short-lived approval, and submit the exact typed confirmation `EXECUTE LIVE ORDER`. Do not call the execute endpoint with a fabricated or reused approval.
- [ ] Watch the order through confirmed fill, protective OCO verification, exit monitoring, fill/commission reconciliation, and final settlement. Never treat a submitted order as a fill or gross proceeds as net proceeds.
- [ ] Compare GameVortex's order state, entry/exit fills, commissions, protective orders, realized P/L, and ledger settlement with Binance's actual records.
- [ ] If any mismatch, timeout, missing protection, or uncertain state occurs, stop new entries, keep the circuit breaker engaged, and reconcile against Binance before proceeding. Do not retry a potentially submitted order with a new client order ID.
- [ ] After the controlled review, block any further entries through the owner TradingControl/emergency-stop control while leaving the live flag enabled for monitoring of existing positions. **Do not set `GAMEVORTEX_LIVE_TRADING_ENABLED=false` while any live order is unresolved or any position remains open**: the current adapter gate also blocks signed order-status, fill, protection, and settlement calls when the flag is false. Set the flag to `false` only after every live order is terminal, protection/exit state is reconciled, and wallet settlement is verified. Record the commit, deployment, order identifiers, reconciliation result, and explicit go/no-go decision.

## Immediate NO-GO conditions

Any unchecked gate; inactive/unreviewed Shariah policy; pending migration; failed or unrun executor failure drills; uncertain API-key restrictions; stale market data; failed Binance preflight; active emergency stop/circuit breaker; unverified protective exit; unresolved order state; or unverified settlement means **NO-GO**. Do not enable live trading to discover whether a guard works.
