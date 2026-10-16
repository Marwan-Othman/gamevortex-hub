# Live execution route, monitor cron, and safety guards

## Endpoints

### `POST /api/admin/trading/live/execute` (owner only)

The route is owner-only and has layered checks for the live flag, consumed owner approval, emergency stop/circuit breaker, provider preflight, risk, Shariah policy, fresh market data, and slippage. Those checks do **not** mean the current system is ready for real orders: the independent accounting readiness guard deliberately rejects new live execution with `LIVE_TRADING_ACCOUNTING_NOT_READY`.

### `GET /api/cron/trading-live-monitor` (secret protected)

Needs `Authorization: Bearer $CRON_SECRET`. Monitor mode is intended to reconcile already-existing orders without submitting a new BUY. It may still query the configured exchange, update order state, and attempt settlement; keep the cron secret server-side and configure it consistently in GitHub Actions and Vercel.

## Wallet funding boundary

The owner trading panel's `POST /api/admin/trading/wallet-funding` route performs an **internal database transfer only** from the site's money wallet to `OwnerWallet`. It debits and credits internal balances in one transaction and records wallet, owner-ledger, and audit rows. Its idempotency key prevents a retry from debiting the same transfer twice.

This operation does **not** send money to Binance or Bybit, does not fund an exchange account, and does not prove that funds are held by an exchange. Likewise, exchange trade fills prove execution, not that net proceeds were transferred back to GameVortex.

The source wallet has no single-currency column, and the payment system supports multiple currencies. The funding route therefore rejects a new transfer when either the owner's wallet transaction history contains any non-USD currency or a completed wallet deposit is recorded in a non-USD currency (`TRADING_FUNDING_SOURCE_CURRENCY_NOT_VERIFIED`). Checking both records prevents a foreign-currency deposit from being missed when transaction history is incomplete. This is intentionally conservative: historical non-USD entries must be reconciled or converted through a verified, auditable process before that wallet can fund USD trading capital. The guard does not itself perform currency conversion.

## Settlement and readiness blockers

- `LIVE_TRADING_ACCOUNTING_NOT_READY` blocks preparation and new execution until a real funding/custody path, reconciliation, and end-to-end settlement are implemented and verified.
- `EXCHANGE_PROCEEDS_TRANSFER_NOT_VERIFIED` blocks crediting exchange proceeds to `OwnerWallet` without independently verified transfer evidence.
- For orders in `CLOSED` / `EXCHANGE_CLOSED_PENDING_WALLET`, the settlement function now checks the transfer blocker inside a locked database transaction **before querying exchange trade fills**. It records the order as blocked and returns without crediting either wallet or trading ledger. This is a fail-closed guard, not a completed proceeds-transfer rail.
- The USD owner wallet does not treat USDT or USDC as USD. A verified conversion with a traceable rate and timestamp is required before those proceeds could be credited as USD.
- Bybit's native linked protective exit/OCO implementation is not complete; the executor must not send an unprotected live order through that path.
- The inspected executor still has provider-specific Binance execution checks. The existence of a Bybit adapter does not establish complete Bybit execution, protection, and settlement support.
- Existing orders that cannot be reconciled safely may require manual review. Do not mark proceeds settled merely because an exchange order is closed.

## Protection and emergency handling

For an already-existing position, reconcile provider order state and fills before any accounting action. Never infer sellable quantity from gross executed quantity when fees may have been charged in the base asset. If protection or quantity cannot be verified, keep the order blocked, trip the circuit breaker as appropriate, and require manual review rather than inventing a quantity or crediting the wallet.

## Still required before live trading

1. Implement and verify the actual site-wallet-to-exchange funding/custody path, including exchange-side transfer evidence and reconciliation.
2. Implement return-of-proceeds transfer evidence and idempotent reconciliation back to the site wallet.
3. Run isolated database drills for partial fills, duplicate events, timeouts, retries, transfer mismatches, and settlement conflicts.
4. Complete qualified Shariah review and resolve provider/account eligibility before considering any live activation.
5. Re-run CI and deployment checks after each code change.

Do not enable live execution or remove the accounting guards based only on a successful build or test run. No real order, exchange transfer, or production balance change is performed by these documentation steps.
