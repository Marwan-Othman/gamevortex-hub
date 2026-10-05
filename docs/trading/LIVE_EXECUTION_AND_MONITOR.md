# Live execution route, monitor cron, and safety guards

## Endpoints

### `POST /api/admin/trading/live/execute` (owner only)
Body: `{ "approvalId": "...", "opportunityId": "...", "confirm": "EXECUTE LIVE ORDER" }`

- Requires `GAMEVORTEX_LIVE_TRADING_ENABLED=true`, a consumed owner approval, a clean emergency-stop/circuit-breaker state, a clean Binance production preflight, a current Risk Manager pass and an APPROVED (reviewed) Shariah decision.
- Submits at most one BUY per approval (idempotent). Calling it again only reconciles the same order.
- Before any exchange call it checks the current 1m price against the approved price (`TRADING_LIVE_MAX_SLIPPAGE_PERCENT`, default 0.5%) and that the market data is fresh. A blocked order stays `INTENT_CREATED` and nothing is sent to Binance.

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
The exit-settlement check "exit quantity covers entry quantity" now compares against the same net sellable quantity. Before, a BUY fee charged in the base asset made a correct exit look like an unsettled position.

## Still manual / not covered
- The Shariah policy v1.0 is seeded `INACTIVE` and unreviewed. It must be reviewed by a qualified scholar and activated before any order can be APPROVED.
- Emergency-exit wallet accounting.
- Executor-level failure drills that need a database.


## Direct funding mode (owner trades own Binance balance)

By default a live order needs an ACTIVE Owner Wallet allocation with exactly the order amount, and the result is credited back to the wallet ledger.

Setting `GAMEVORTEX_LIVE_DIRECT_FUNDING=true` switches to direct funding:

- no allocation is bound, and no wallet/ledger/trading-account row is changed;
- when the protected exit has closed on Binance the order is marked `SETTLED` and a `TRADING_LIVE_DIRECT_SETTLED` audit row records the realized P/L;
- all other gates are unchanged: Shariah, Risk Manager, emergency stop / circuit breaker, per-trade owner approval, typed `EXECUTE LIVE ORDER`, Binance preflight, slippage guard, minimum notional, protective OCO.

The admin "Live Order" panel (`/admin/trading`) uses `POST /api/admin/trading/live/prepare` (checks + short-lived approval, never sends an order), then the existing approval-consume and `/live/execute` routes. `GET/POST /api/admin/trading/live/orders` lists orders and refreshes one in monitor mode.
