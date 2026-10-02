# Binance Spot production adapter — safety boundary

## Purpose

`lib/trading/binance-spot-live-adapter.ts` is the provider adapter boundary for the future GameVortex live executor. It is not an authorization layer and it does not decide whether a trade should be made.

The adapter provides only the provider-facing operations required by the live execution stage:

- production Spot market-data reads;
- BUY order submission using a server-side client order id;
- provider order-status lookup by client order id;
- protected SELL OCO submission after a confirmed BUY fill.

## Fail-closed rules

1. `GAMEVORTEX_LIVE_TRADING_ENABLED` must be explicitly `true` before any live BUY, order-status lookup, or protected-exit submission can reach Binance.
2. The production base URL is fixed to `https://api.binance.com`.
3. `BINANCE_LIVE_API_KEY` and `BINANCE_LIVE_API_SECRET` are read server-side only.
4. The adapter declares withdrawals, margin, leverage, short selling, and derivatives as unsupported.
5. A protected exit is submitted as one exchange-level OCO order list, not as two unrelated SELL orders.
6. The adapter requires Binance to return both OCO legs and verifies the returned client-order identities before reporting success.
7. Malformed or incomplete provider responses throw a stable internal error. The caller must place the local live order into `UNKNOWN` and reconcile against provider state rather than assuming success.
8. This stage does not enable the live flag and does not expose a public live-order route.

## Binance contract used

The adapter uses the current Spot REST order-list endpoint `POST /api/v3/orderList/oco` for protected exits and `GET /api/v3/order` for order-status lookup. Binance documents OCO as a two-order one-cancels-the-other structure and requires the SELL price relationship to respect the current market price. The adapter therefore accepts the precomputed protected-exit plan only after the local trading layer has validated its prices and quantities.

The legacy `POST /api/v3/order/oco` endpoint is not used.

## Current boundary

This adapter is intentionally not wired to an enabled production executor yet. The remaining stages are:

- connect the adapter to the durable live-order state service;
- submit and verify protected exits immediately after confirmed fills;
- verify settlement and wallet balances;
- integrate emergency-stop handling;
- complete transactional audit coverage;
- run controlled failure/reconciliation tests;
- define and execute the first-live-order procedure with the live flag still off until every gate passes.
