# GameVortex Hub — Site Wallet to Binance Spot Funding Bridge

Status: design and implementation gate. This document does not enable live trading.

## Required user-visible behavior

The owner's site wallet is the source ledger. The trading allocation is a reservation in the site's ledger, not a Binance deposit. A real Spot order can only be submitted when an actual, reconciled funding path has made the corresponding quote asset available to the execution account.

After a position is fully closed and the exchange's fills and fees are reconciled, GameVortex must credit the net settled proceeds to the site's owner wallet exactly once. An order must not be marked settled before all required ledger writes commit.

## Current implementation in this branch

- `app/api/admin/trading/wallet-funding/route.ts` transfers value from the site's internal user wallet to `OwnerWallet`; it does not call Binance.
- `lib/trading/allocation.ts` moves funds internally from `OwnerWallet` to `TradingAccount`; it does not fund an exchange account.
- `lib/trading/live-prepare.ts` and `lib/trading/live-production-executor.ts` fail closed with `LIVE_TRADING_ACCOUNTING_NOT_READY`. Keep both independent gates in place so a previously issued approval cannot bypass the accounting block.
- `lib/trading/live-wallet-settlement.ts` currently blocks wallet credit before querying exchange fills because no independently verified exchange-to-site proceeds-transfer rail exists. The downstream fee/ledger settlement code is not evidence that end-to-end settlement is available; it must remain unreachable until the transfer proof and reconciliation are implemented.
- The read-only Binance preflight validates credentials and account/API-key restrictions. It is not a funding transfer and does not prove that site-ledger money is held at Binance.

## Why an automatic transfer cannot be fabricated from a database balance

An internal USD ledger entry does not create USD/USDT at Binance. A bridge needs a real source of funds and a supported funding rail, with ownership, destination, asset/network, fee, confirmation, and reconciliation controls. The Spot trading API's order endpoint only submits orders against assets already available to the Binance account; it does not debit a website database.

Do not enable Binance withdrawals/transfers on the trading API key as a shortcut. Do not auto-credit a wallet based on a submitted order, estimated P/L, or an unconfirmed provider response.

## Implementation phases

1. **Keep the live-order gate closed.** No production orders until the funding and settlement paths are verified.
2. **Define the actual funding rail.** Decide where the site's USD is held in real life and how it can lawfully and technically be converted into the quote asset and delivered to the execution account. This cannot be inferred from the current repository.
3. **Add a funding state machine** with idempotent records such as REQUESTED, SUBMITTED, CONFIRMED, FAILED, and RECONCILIATION_REQUIRED. Keep provider references and amounts in a durable ledger; never store secrets in the browser.
4. **Only allow an order against confirmed, reserved exchange liquidity.** Reserve site funds atomically and bind one allocation to one order. Unknown provider outcomes must block duplicate submission and trigger reconciliation.
5. **Settle closed trades once.** Query actual fills, account for fees and quote/base-asset fee cases, calculate net proceeds, and credit the site wallet atomically with immutable ledger/audit records. Handle principal, profit, loss, fees, and rounding explicitly.
6. **Test failure paths.** Duplicate requests, timeouts with unknown provider outcomes, partial fills, rejected orders, missing exit protection, fees paid in base asset, exit reconciliation failures, concurrent allocations, and duplicate settlement must all be tested.
7. **Enable live execution only after end-to-end staging evidence.** Passing API preflight alone is insufficient.

## Required verification before live enablement

- Evidence of the real funding rail and actual destination balance.
- Exact reconciliation between reserved site capital, funding records, exchange available/locked balances, and open orders/positions.
- Demonstrated buy → protective exit → confirmed sell → net proceeds credited to site wallet, without duplicate ledger entries.
- Verified emergency-stop and recovery behavior.
- Explicit owner approval for the first live trade.