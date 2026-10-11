# Phase 11 — Store / Marketplace audit

Scope: products (create / edit / delete / publish), pricing, free and paid products, purchase (wallet and card),
points rewards, owner wallet, product access (keys), duplicate purchases, refunds, gift cards, VIP.
Phases 6 and 7 already covered the wallet, ledgers, webhooks and VIP in depth; this phase re-checked the store
paths on top of them and only fixes what is new.

## Checked and found correct (not changed)

* All product / key / refund routes re-check SUPER_ADMIN on the server and use `guardMutation`.
* Wallet purchase, key delivery, owner revenue, buyer points are one transaction with `FOR UPDATE` on the order and the wallet, a conditional debit and idempotency keys; keys are claimed with `SKIP LOCKED`.
* Keys are AES-256-GCM encrypted, never returned by list APIs; `/api/me/orders/[id]/keys` only serves the buyer's paid/free, non-refunded order and `no-store`.
* Prices are integer cents, order items snapshot `unitPriceCents`, the total is computed on the server from the database prices (the client never sends a price).
* Free products are completed at order creation (keys + entitlement + points in one transaction).
* VIP and FazerCards gift cards: VIP is covered by phase 7. Gift cards are a display-only catalog (`/gift-cards`); the order API only sells `GAME_KEY` + `CODE`, so a gift card cannot be bought by mistake.

## Problems found and fixed

| # | Area | Problem | Fix |
|---|------|---------|-----|
| 1 | Pricing / purchase | **Stale orders could be paid.** A pending order has no expiry and wallet checkout never looked at the product again: after the owner raised a price, withdrew a product, unpublished the game or lost verification, the old order could still be paid at the old price. Card checkout checked availability but not the price. | `orderSaleProblem` (new `lib/store-guards.ts`): at wallet and card checkout every item must still be active, verified, a supported type, on a published verified game, **and** cost what the order says (`ORDER_PRICE_CHANGED` / `ORDER_ITEM_NOT_AVAILABLE_FOR_SALE`, 409). |
| 2 | Duplicate purchases | Nothing stopped buying a game you already own (a second key was consumed, the money taken). | `ALREADY_OWNED` (409) at order creation, wallet checkout and card checkout, based on the active Entitlement. Order creation takes a per-user advisory lock so two simultaneous requests cannot both pass. |
| 3 | Free products | A free product could be claimed again and again with new idempotency keys: each claim drained a key and **paid reward points again** (points farming). Quantity > 1 was allowed. | A free product is one copy per user (`FREE_PRODUCT_QUANTITY_LIMIT`, `FREE_PRODUCT_ALREADY_CLAIMED`), checked under the same lock. |
| 4 | Refund / access | Access is one row per user+game pointing at the **first** purchase. Refunding that first order revoked the game even when the user had bought it again validly (wallet refund and webhook refund). | `revokeEntitlementsForRefund`: revokes, then moves access to another still-valid purchase of the same game when there is one. Used by both refund paths. |
| 5 | Owner wallet / refund | The refund looked for the owner wallet of **the admin who clicked refund**, not the wallet that received the sale, so with another SUPER_ADMIN the sale revenue was never taken back. | The wallet is found from the original `sale-revenue` / `sale-points` ledger rows. |
| 6 | Publishing | The "publish" button sent `active + supplierVerified` directly, which skipped the checks of `publish` (game published, source verified, keys available). | The button sends `publish: true`; the API treats `active: true` exactly like `publish: true`. The key check now counts **available** keys (it counted all keys, even delivered ones). |
| 7 | Keys / publish deadlock | Keys could only be imported for a supplier-verified product, but publishing (which verifies) needs keys. | Keys can be loaded before publishing (an inactive product is never shown, keys are encrypted). Flow: create → add keys → publish. |
| 8 | Stock | `inventory` could be typed by hand and drift from the real number of keys (blocking sales, or promising keys that do not exist). | For GAME_KEY + CODE the stock is always the number of available keys. |
| 9 | Deleting a product | A product with any key could never be deleted, even if no key was ever sold. | Never-sold keys are deleted with the product; delivered/revoked keys or any order still block it (`PRODUCT_HAS_DIGITAL_KEYS`, `PRODUCT_HAS_ORDERS`). |
| 10 | Validation | `currency` accepted any 3–10 characters; `sourceUrl` accepted any scheme (`javascript:`). | Currency = 3 letters; `sourceUrl` = http(s) only. |
| 11 | Marketplace page | Listed sold-out products (the API did not), and showed a hard-coded "+10 points" on every free product. | Same availability rule as the API; the real `rewardPoints` is shown. |
| 12 | UI messages | Raw codes (`GAME_SOURCE_NOT_VERIFIED`…) shown to the owner; buyers got a generic failure for owned / claimed / repriced items. | Arabic messages for the admin errors and for the new purchase errors. |

## Tests

* New `tests/store-guards.test.ts`: sale/price checks, free product rule, owned games, refund access move (with stubbed client).
* The pure test files (store-guards, content-admin, downloads …) pass here (27 checks). `npm install` is blocked in the audit environment, so run `npm run production:validate` on your side (Prisma generate, `tsc`, `vitest`, `next build`). No new migration in this phase.

## Decisions to confirm

* **A game you already own cannot be bought again** (even a second copy as a gift). Easy to relax: remove the `ownedGameIds` check in `/api/me/orders` and the two checkouts.
* **Publishing needs a game with source status `VERIFIED` or `OFFICIAL_SOURCE`.** Games uploaded from `/admin/content` get `LICENSED_FOR_DISTRIBUTION` (phase 10), so they cannot get a store product until their source status is set. This is the existing rule; it was only hidden before because the old button bypassed it.
* A wallet refund is refused (`OWNER_USD_BALANCE_INSUFFICIENT_FOR_REFUND`) when the owner already withdrew the sale revenue (phase 6 decision, unchanged).

## Known limitations (not changed)

* Pending orders never expire (they are now harmless because they are re-validated at payment).
* Card refunds are made from the payment provider's dashboard and reach the site through the webhook; there is no card-refund button.
