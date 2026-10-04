# Binance Spot production adapter — safety boundary

## Purpose

`lib/trading/binance-spot-live-adapter.ts` is the provider adapter boundary for the GameVortex live executor. It is not an authorization layer and it does not decide whether a trade should be made.

The adapter provides only the provider-facing operations required by the live execution stage:

- production Spot market-data reads;
- BUY order submission using a server-side client order id;
- provider order-status lookup by client order id;
- exact provider trade-fill lookup for fee reconciliation;
- protected SELL OCO submission after a confirmed BUY fill;
- protected-exit leg status lookup.

## Fail-closed rules

1. `GAMEVORTEX_LIVE_TRADING_ENABLED` must be explicitly `true` before any live BUY, order-status lookup, trade-fill lookup, or protected-exit submission can reach Binance.
2. The production base URL is fixed to `https://api.binance.com`.
3. `BINANCE_LIVE_API_KEY` and either `BINANCE_LIVE_API_SECRET` (HMAC-SHA256) or `BINANCE_LIVE_API_PRIVATE_KEY` (Ed25519 PKCS#8 PEM) are read server-side only. If both signing credentials are configured, Ed25519 is preferred.
4. The adapter declares withdrawals, margin, leverage, short selling, and derivatives as unsupported.
5. A protected exit is submitted as one exchange-level OCO order list, not as two unrelated SELL orders.
6. The adapter requires Binance to return both OCO legs and verifies the returned client-order identities before reporting success.
7. Provider authentication, timestamp, signature, rate-limit, network, and provider failures are normalized into stable internal error codes. The caller must place ambiguous live-order states into `UNKNOWN` and reconcile against provider state rather than assuming success.
8. This adapter does not enable the live flag and does not expose a public live-order route.

## Binance contract used

The adapter uses the current Spot REST order-list endpoint `POST /api/v3/orderList/oco` for protected exits and `GET /api/v3/order` for order-status lookup. Binance documents HMAC, RSA, and Ed25519 as supported Spot signing methods; GameVortex implements HMAC and Ed25519 here. urlBinance Spot REST API documentationhttps://developers.binance.com/en/docs/products/spot/rest-api

The legacy `POST /api/v3/order/oco` endpoint is not used.

## Current boundary

The adapter is wired to the durable live-order coordinator, protected-exit reconciliation, and allocation-backed wallet settlement. Production authorization remains fail-closed until all risk, Shariah, account-restriction, failure-drill, migration, and first-live-order gates are explicitly verified.
