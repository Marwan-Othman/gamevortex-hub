# Live execution route, monitor cron, and safety guards

## Endpoints

### `POST /api/admin/trading/live/execute` (owner only)
Body: `{ "approvalId": "...", "opportunityId": "...", "confirm": "EXECUTE LIVE ORDER" }`

- Requires `GAMEVORTEX_LIVE_TRADING_ENABLED=true`, a consumed owner approval, a clean emergency-stop/circuit-breaker state, a clean Binance production preflight, a current Risk Manager pass and an APPROVED Shariah decision.
- Submits at most one BUY per approval (idempotent). Calling it again only reconciles the same order.
- Before any exchange call it checks the current 1m price against the approved price (`TRADING_LIVE_MAX_SLIPPAGE_PERCENT`, default 0.5%) and that the market data is fresh. A blocked order stays `INTENT_CREATED` and nothing is sent to Binance.

## Shariah review gate — mandatory for real money

The Shariah Guard is a software enforcement layer, not a religious ruling. **Owner self-review is not enough to authorize real-money trading.** The stored `ShariahPolicy` row must satisfy all of these conditions before the guard can return `APPROVED`:

Separately, the manual live-order preparation endpoint currently fails closed with `LIVE_TRADING_ACCOUNTING_NOT_READY` after the feature-flag check. This is intentional: USD-wallet migration, custody reconciliation, and production accounting/reconciliation have not been verified end to end. Do not remove this gate or set the live flag to get around it.

- `status = ACTIVE`
- `reviewedAt` is set only after a real review has occurred
- `source = QUALIFIED_ISLAMIC_FINANCE_SCHOLAR_REVIEW`
- `notes` identify the reviewer, their relevant qualification, review date, and supporting evidence/reference

The source marker is an explicit provenance attestation, not cryptographic or independent verification of a scholar's credentials. Validate the reviewer and supporting evidence outside the application before making this change. Do not set the marker merely to pass a software check. Unknown or owner-only review remains blocked as `REVIEW`.

The production row for `owner-spot-v1` had previously been marked ACTIVE with `OWNER_SELF_REVIEW`. That configuration is invalid for real-money use and has been returned to `INACTIVE`, with `reviewedAt` cleared. No exchange order was submitted by that corrective action. The policy must stay inactive until a qualified review is completed and independently checked.

## Monitor and cron

### `GET /api/cron/trading-live-monitor` (secret protected)
Needs `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends it when `CRON_SECRET` is set). Runs the executor in **monitor** mode for open orders: reconcile, protect, settle. Monitor mode can never submit a BUY, and keeps working while the circuit breaker is tripped and after the approval window has ended. It does nothing while the live flag is false.

`vercel.json` ships a **daily** schedule because Vercel Hobby only allows daily crons (a more frequent schedule fails the deployment on Hobby). On Vercel Pro change it to `*/5 * * * *`. On Hobby you can instead call the URL every few minutes from an external scheduler with the Bearer header.

## Protection and emergency exit

After a confirmed fill the executor places the protective OCO for the **net sellable quantity** (executed quantity minus any base-asset commission, floored to the symbol step). If protection cannot be confirmed it:
1. marks the order `PROTECTION_FAILED` and trips the circuit breaker;
2. tries one emergency MARKET SELL of the same net quantity (deterministic client id, so it cannot double-sell);
3. writes `TRADING_LIVE_EMERGENCY_EXIT_SOLD` or `TRADING_LIVE_EMERGENCY_EXIT_FAILED` to the audit log;
4. never credits the wallet. Settlement of an emergency exit is manual and must be verified against Binance.

If the OCO request timed out but actually reached Binance, the coins are locked by the OCO and the emergency sell will be rejected. That is intentional; check Binance and reconcile by hand.

## Exit settlement fix

The exit-settlement check "exit quantity covers entry quantity" compares against the same net sellable quantity. Previously, a BUY fee charged in the base asset could make a correct exit look like an unsettled position.

## Database-backed drills and remaining gaps

The GitHub Actions workflow runs opt-in PostgreSQL state drills against its isolated CI database (`GAMEVORTEX_TRADING_DB_DRILLS=true`). They cover concurrent idempotent intent creation, immutable amount on retry, ensuring `INTENT_CREATED` orders are not exposed to the live monitor, and rejecting stale state transitions. The flag is not set in Vercel, so application builds never write test rows into a deployment database.

These are persistence/state tests, not full end-to-end proof of live execution. Still manual / not covered:

- Full executor-level failure drills spanning approval consumption, exchange responses, DB state, protection/OCO, emergency exit, and final settlement.
- Emergency-exit wallet accounting.
- Qualified review of the Shariah policy and the provenance evidence above.
- Verification of capital custody and production reconciliation.
- Lawful availability of Binance Spot for the account and deployment location. Do not bypass restricted-location responses.

## Direct funding mode — disabled pending separate review

The code intentionally rejects direct funding with `LIVE_DIRECT_FUNDING_DISABLED`. Do not set `GAMEVORTEX_LIVE_DIRECT_FUNDING=true` to bypass the accounting readiness gate. The production path remains blocked until wallet accounting, capital custody/reconciliation, exit settlement, and end-to-end failure handling have been verified. Any future direct-funding implementation must be separately reviewed and tested; the previous description of direct funding as an available mode should not be treated as proof that it is operational.

The admin "Live Order" panel (`/admin/trading`) uses `POST /api/admin/trading/live/prepare` (checks + short-lived approval, never sends an order), then the existing approval-consume and `/live/execute` routes. Preparation currently stops at the accounting readiness gate and does not create an approval. `GET/POST /api/admin/trading/live/orders` lists orders and refreshes one in monitor mode.
