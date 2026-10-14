# GameVortex AI Trading — First Live Order Procedure

## Purpose

This procedure is the final owner-controlled gate for a first real-money Spot order. It does not enable live trading automatically and it does not bypass Shariah, risk, allocation, approval, reconciliation, protection, or settlement guards.

## 0. Non-negotiable boundary

- The application live flag must remain `false` until every preceding gate is green.
- The first real order is submitted only by the Owner from the authenticated trading UI.
- Never paste Binance secrets into chat, source code, logs, screenshots, or GitHub.
- Use a Binance Spot API credential with withdrawals disabled and only the permissions required by the application.
- Prefer IP restriction when a stable egress IP is available.
- The application minimum is `$1`; Binance symbol-specific filters can require more.

## 1. Research gate

Do not interpret a backtest win as proof of profitability. The strategy must pass the project's independent train/test criteria on unseen data, after fees and slippage, with the required minimum number of trades and symbol coverage.

If the strategy gate fails, stop here. Do not enable live trading.

## 2. Production database gate

From a clean database, verify:

- Prisma schema validation passes.
- The complete migration chain applies cleanly.
- `npm ci` passes.
- `npm run typecheck` passes.
- `npm test` passes.
- `npm run build` passes.

The exact `main` commit intended for deployment must be the commit that passed these checks.

## 3. Binance preflight

Owner supplies the production credentials only through Vercel's server-side environment configuration:

- `BINANCE_LIVE_API_KEY`
- `BINANCE_LIVE_API_SECRET` for HMAC, or the documented Ed25519 private-key variable when that credential type is intentionally used.
- `CRON_SECRET` for protected scheduled endpoints.

Then redeploy production and run the Binance production preflight.

Required results:

- credentials: PASS
- Spot account: PASS
- Spot trading: PASS
- withdrawals disabled: PASS
- margin disabled: PASS
- futures disabled: PASS
- options disabled: PASS
- portfolio margin disabled: PASS
- internal transfer disabled: PASS

A preflight success is not itself authorization to trade.

## 4. Trading-control gate

Before an order can be submitted:

- Emergency Stop: cleared by the Owner.
- Circuit breaker: no active reason.
- Trading control: unblocked.
- Shariah policy: reviewed and approved.
- Asset Shariah status: approved for the exact asset and method.
- Risk Manager: current configuration approves the requested amount and exposure.
- A single active trading allocation covers the order.

## 5. Opportunity and approval gate

The opportunity must contain a current market observation and execution snapshot.

The Owner must explicitly approve the opportunity. The approval must be unexpired and consumed exactly once by the live execution path.

The execution request must contain the exact confirmation text:

`EXECUTE LIVE ORDER`

## 6. First-order sizing

Use the smallest amount permitted by the exchange's current symbol filters and the application's `$1` minimum, subject to Risk Manager limits. Do not increase size merely because the first order appears profitable.

## 7. Execution gate

The live executor must, in order:

1. Verify the Owner approval.
2. Re-check TradingControl.
3. Re-run Binance production preflight.
4. Re-check Shariah approval.
5. Re-evaluate Risk Manager state.
6. Create a durable idempotent order intent.
7. Bind the order to exactly one active allocation.
8. Validate current Binance symbol rules.
9. Submit at most one BUY.
10. Reconcile the provider state using the immutable client order ID.
11. Treat ambiguous provider failures as `UNKNOWN`; never blindly retry a potentially submitted order.
12. Require a confirmed fill before protection.
13. Submit and verify the protective exit legs.

## 8. After entry

An open position is not considered safe merely because the BUY succeeded. The protective exit must be accepted and both exit identities verified before the order becomes `PROTECTED`.

If protection fails:

- Do not place another BUY.
- Trip the circuit breaker.
- Attempt the controlled emergency exit according to the executor's fail-closed policy.
- Reconcile the provider state before any retry.

## 9. Close and settlement

The exchange position is considered closed only after the provider confirms the completed exit leg and the opposite OCO leg is terminal/canceled.

Wallet settlement occurs only after fill-level commission reconciliation and the allocation-backed settlement transaction succeed.

Gross exchange proceeds must never be credited directly to the internal wallet when fees have not been reconciled.

## 10. First-order post-trade reconciliation

Owner must verify, from both Binance and GameVortex:

- symbol
- client order ID
- provider order ID
- requested quantity
- executed quantity
- average entry price
- exit price
- commissions and commission assets
- gross realized P/L
- net proceeds
- Owner Wallet settlement
- Trading Ledger entry
- allocation release/closure
- audit events
- final TradingControl state

Any mismatch is a stop condition. Do not start another live order until the mismatch is resolved.

## 11. Stop conditions

Stop immediately for:

- unknown provider order state
- reconciliation mismatch
- partial fill not covered by the protection plan
- protection failure
- stale market observation
- Shariah uncertainty
- risk-limit breach
- circuit breaker trip
- wallet-settlement failure
- database/migration uncertainty
- monitoring outage that could leave an open position unmanaged

## 12. Explicit owner authorization

The Owner is the only person who performs the final production enablement and the first real-money submission. The application and repository must not silently enable live trading, fabricate a successful preflight, or bypass the confirmation boundary.
