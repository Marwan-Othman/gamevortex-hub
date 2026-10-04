# Binance Spot Live — Read-only preflight

This stage does **not** enable live trading and does not submit orders.

## Server-side environment variables

Add these only in Vercel Production as Secret variables:

- `BINANCE_LIVE_API_KEY`
- `BINANCE_LIVE_API_SECRET` for a classic HMAC-SHA256 Spot key, or `BINANCE_LIVE_API_PRIVATE_KEY` for an Ed25519 PKCS#8 private key
- `GAMEVORTEX_LIVE_TRADING_ENABLED`

Keep all credentials server-side. Never use `NEXT_PUBLIC_` and never commit their values. If both signing credentials are configured, the Ed25519 private key is preferred.

`GAMEVORTEX_LIVE_TRADING_ENABLED` must remain unset or `false` until the live executor, protective exit-order path, reconciliation, settlement, and emergency-stop validation have all passed.

## Preflight checks

The owner-only endpoint `GET /api/admin/trading/exchange/live/preflight` performs read-only checks against Binance production:

- Spot account type.
- Spot trading enabled for the API key.
- Withdrawals disabled for the API key.
- Margin disabled.
- Futures disabled.
- Vanilla Options disabled.
- Portfolio Margin disabled.
- Internal transfers disabled for the initial isolated trading stage.
- Explicit GameVortex live-trading flag.

The Binance API exposes API-key restrictions through `GET /sapi/v1/account/apiRestrictions`; the project uses that endpoint rather than assuming that an account-level status is sufficient. Binance's current Spot REST documentation also confirms support for HMAC, RSA, and Ed25519 signing methods. urlBinance Spot REST API documentationhttps://developers.binance.com/en/docs/products/spot/rest-api

Provider failures are normalized into stable diagnostics such as authentication failure, invalid timestamp, invalid signature, rate limiting, restricted location, network failure, or provider error. They must never collapse into an unexplained `INTERNAL_ERROR` when a safe classification is possible.

## Current safety boundary

A successful preflight is **not** authorization to trade real money. The production coordinator additionally requires owner approval, TradingControl/emergency-stop clearance, reviewed Shariah approval, current Risk Manager approval, allocation binding, durable idempotency, provider reconciliation, confirmed fills, protected OCO verification, exit reconciliation, and allocation-backed wallet settlement. The live flag remains disabled until the complete production gate passes.
