# Bybit Spot production adapter

`lib/trading/bybit-spot-live-adapter.ts` implements the Bybit V5 Spot boundary behind the shared `ExchangeAdapter` contract.

## Supported operations

- Public Spot kline market data through `GET /v5/market/kline`.
- Server-side authenticated Spot market BUY using quote currency (`marketUnit=quoteCoin`).
- Idempotent order correlation using Bybit `orderLinkId`.
- Order reconciliation through `GET /v5/order/realtime`.
- Emergency Spot market SELL using base currency (`marketUnit=baseCoin`).
- Protected TP/SL legs using two Bybit Spot conditional orders, with separate client IDs and fail-closed handling if either leg cannot be submitted.

## Safety boundary

- The official endpoint is restricted to `https://api.bybit.com` or `https://api-testnet.bybit.com`.
- Credentials are read only from `BYBIT_LIVE_API_KEY` and `BYBIT_LIVE_API_SECRET` on the server.
- `GAMEVORTEX_LIVE_TRADING_ENABLED=true` is required before authenticated calls are allowed.
- Withdrawals, margin, leverage, short selling and derivatives are declared unsupported.
- The adapter never logs credentials or returns them to the client.
- Provider errors are normalized to stable internal error codes.

## Required environment variables

```env
BYBIT_LIVE_API_KEY=
BYBIT_LIVE_API_SECRET=
BYBIT_LIVE_BASE_URL=https://api.bybit.com
GAMEVORTEX_LIVE_TRADING_ENABLED=false
```

Use `https://api-testnet.bybit.com` only for a separately reviewed testnet deployment. Do not enable live trading until the unified executor, owner approval, Shariah Guard, risk gates, reconciliation and wallet settlement have been verified end-to-end in staging.

Official references: [Bybit V5 authentication](https://bybit-exchange.github.io/docs/v5/guide), [Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order), [Get Open & Closed Orders](https://bybit-exchange.github.io/docs/v5/order/open-order), [Get Kline](https://bybit-exchange.github.io/docs/v5/market/kline).
