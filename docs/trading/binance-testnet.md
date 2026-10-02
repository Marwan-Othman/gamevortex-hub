# Binance Spot Testnet — GameVortex AI Trading

This document covers the testnet integration stage only. It does not enable live trading.

## Required Vercel environment variables

Set these as server-side Production environment variables:

- `BINANCE_TESTNET_API_KEY`
- `BINANCE_TESTNET_API_SECRET`

Do not use `NEXT_PUBLIC_` for either variable. Do not commit their values.

## Required key policy

The testnet execution gate requires:

1. `canTrade === true`
2. `canWithdraw === false`
3. The account permissions include `SPOT`
4. The adapter targets exactly `https://testnet.binance.vision`

The status endpoint is:

`GET /api/admin/trading/exchange/testnet/status`

It is restricted to the existing trading owner guard and returns only permission/status data. It does not return the API secret and does not submit an order.

## Current safety boundary

Paper Trading remains simulation-only. Binance Spot Testnet is a separate integration stage. The production/live executor is still fail-closed.

A successful testnet status check is **not** approval for real-money trading. Before live trading, the project still requires a separately reviewed production adapter, live credential isolation, order reconciliation/idempotency, settlement verification, emergency stop validation, and a controlled first-live-order procedure.
