# Binance Spot Testnet — GameVortex AI Trading

This document covers the testnet integration stage only. It does not enable live trading.

## Required Vercel environment variables

Set these as server-side Production environment variables:

- `BINANCE_TESTNET_API_KEY`
- `BINANCE_TESTNET_API_SECRET`

Do not use `NEXT_PUBLIC_` for either variable. Do not commit their values.

## Required key policy and status interpretation

The Testnet execution gate requires:

1. `canTrade === true`
2. The account type is `SPOT`
3. The account permissions include `SPOT`
4. The adapter targets exactly `https://testnet.binance.vision`

The status endpoint is:

`GET /api/admin/trading/exchange/testnet/status`

It is restricted to the existing trading owner guard and returns only permission/status data. It does not return the API secret and does not submit an order.

**Important:** `canWithdraw` is returned for visibility, but it is not a Testnet readiness gate. Binance Spot Testnet balances are virtual/non-transferable, and the Testnet environment does not provide the same withdrawal-restriction control as a production API key. Do not use this Testnet field to infer production withdrawal restrictions. Production live preflight independently checks the real API key's restrictions and must confirm withdrawals are disabled.

## Current wiring status

The repository contains the guarded Testnet BUY function in `lib/trading/testnet-execution.ts`, but it is not currently called by a Testnet execution API route or by the owner panel. The panel's status action is read-only. It must not report that an order is ready to execute just because account permissions look valid.

A dedicated `TradingTestnetOrder` table and migration now persist a separate Testnet intent, with a unique approval constraint and a compare-and-set transition from `INTENT_CREATED` to `SUBMITTING`. This is deliberately separate from production `TradingLiveOrder` records. The execution function refuses to submit again once the approval is claimed; provider errors or unconfirmed responses become `UNKNOWN`, and a confirmed fill is persisted before writing the audit event.

This is a duplicate-submission guard, not yet a complete recovery workflow. An order stuck in `SUBMITTING` or `UNKNOWN`, or a confirmed fill whose audit write failed, requires provider-side reconciliation before any further action. Do not automatically retry it, and do not wire an order-submission route or UI button until reconciliation and failure-drill tests are in place.

## What Testnet execution currently proves

The guarded Testnet execution path validates the existing owner approval, pre-trade risk/policy plan, and Spot Testnet account before submitting a **market BUY** to the official Spot Testnet endpoint. It records a Testnet fill audit event and does not mutate the GameVortex wallet.

This path does **not** currently establish the complete live lifecycle: it does not provide the production executor's protective OCO placement/verification, exit monitoring, reconciliation, emergency-exit accounting, or wallet settlement. A successful Testnet BUY is therefore not proof that position protection or settlement works end to end.

## Current safety boundary

Paper Trading remains simulation-only. Binance Spot Testnet is a separate integration stage. The production/live executor must remain fail-closed.

A successful Testnet status check or BUY is **not** approval for real-money trading. Before live trading, the project still requires a separately reviewed production adapter, live credential isolation, durable order reconciliation/idempotency, protective-exit verification, settlement verification, emergency-stop validation, executor-level failure drills, independent Shariah review, and a controlled first-live-order procedure.
