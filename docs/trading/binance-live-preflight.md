# Binance Spot Live — Read-only preflight

This stage does **not** enable live trading and does not submit orders.

## Server-side environment variables

Add these only in Vercel Production as Secret variables:

- `BINANCE_LIVE_API_KEY`
- `BINANCE_LIVE_API_SECRET`
- `GAMEVORTEX_LIVE_TRADING_ENABLED`

Keep all three server-side. Never use `NEXT_PUBLIC_` and never commit their values.

`GAMEVORTEX_LIVE_TRADING_ENABLED` must remain unset or `false` until the live executor, protective exit-order path, reconciliation, settlement, and emergency-stop validation have all passed.

## Preflight checks

The owner-only endpoint `GET /api/admin/trading/exchange/live/preflight` performs read-only checks against Binance production:

- Spot account and `SPOT` permission.
- Spot trading enabled for the API key.
- Withdrawals disabled for the API key.
- Margin disabled.
- Futures disabled.
- Vanilla Options disabled.
- Portfolio Margin disabled.
- Internal transfers disabled for the initial isolated trading stage.
- Explicit GameVortex live-trading flag.

The Binance API exposes API-key restrictions through `GET /sapi/v1/account/apiRestrictions`; the project uses that endpoint rather than assuming that an account-level status is sufficient. See the official Binance Developer Documentation for the `apiRestrictions` endpoint.

## Current safety boundary

A successful preflight is **not** authorization to trade real money. The project intentionally has no live order route at this stage. A separate production executor must still implement protected exits, idempotency, order reconciliation, settlement verification, emergency stop handling, audit records, and a controlled first-live-order procedure before the live flag is enabled.
