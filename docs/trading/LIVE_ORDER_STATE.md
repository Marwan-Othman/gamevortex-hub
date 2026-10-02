# GameVortex AI Trading — Live Order State Boundary

## Purpose

This stage adds a durable, provider-neutral order state and reconciliation boundary without enabling real-money order submission.

## Durable state

`TradingLiveOrder` stores:

- owner / approval / opportunity identity;
- deterministic idempotency key and client order ID;
- provider order ID after confirmed provider observation;
- symbol, BUY side, USD amount, entry, stop-loss and optional take-profit;
- normalized provider status;
- executed quantity, cumulative quote quantity and average fill price;
- provider update and reconciliation timestamps;
- explicit error text for unknown or mismatched states;
- monotonic version number.

Secrets, API keys, API secrets, signatures and withdrawal credentials are not stored in this table.

## State machine

`INTENT_CREATED -> SUBMITTING -> SUBMITTED -> PARTIALLY_FILLED -> FILLED -> CLOSED`

Terminal provider states can move to `CLOSED` after settlement/position handling is implemented.

Provider uncertainty can move an order to `UNKNOWN`. A later verified provider observation may reconcile it back into a known state.

Any identity drift moves the order to `RECONCILIATION_MISMATCH` and blocks automatic acceptance. That state has no automatic transition out of it.

## Reconciliation rules

A provider observation must match the stored client order ID, symbol and BUY side. If a provider order ID already exists locally, it must also match. Quantities and provider update timestamps must be valid.

Older provider observations are treated as stale and never overwrite a newer local observation.

## Safety boundary

This layer does not call Binance and does not submit live orders. The production flag remains disabled.

The next stage still requires a separately reviewed production adapter plus protected exit-order handling, settlement verification, emergency-stop integration, and controlled first-live-order procedure.

## External provider note

Binance's Spot API exposes client order IDs and order statuses such as `NEW`, `PARTIALLY_FILLED`, `FILLED`, `CANCELED`, `REJECTED`, and `EXPIRED`. Binance also documents that some 5XX responses can leave execution status unknown, so the application must reconcile before treating an ambiguous submission as failed.
