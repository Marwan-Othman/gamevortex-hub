# Phase 19 - Testing

Run: `npm run test:phase19` (only these suites) or `npm test` (everything).

## Suites

| File | Areas | Tests |
|---|---|---|
| `tests/phase19-auth.test.ts` | Authentication, Authorization | 55 |
| `tests/phase19-wallet-points.test.ts` | Wallet, Points | 54 |
| `tests/phase19-store-marketplace.test.ts` | Store, Marketplace | 59 |
| `tests/phase19-vip-ai-credits.test.ts` | VIP, expired subscription, AI credits | 45 |
| `tests/phase19-ai-api.test.ts` | AI API (chat, image, video, usage, health) | 62 |
| `tests/phase19-games-apps.test.ts` | Games, Apps, downloads, public API | 55 |
| `tests/phase19-admin-owner.test.ts` | Admin, Owner (real role checks) | 79 |
| `tests/helpers/phase19.ts` | shared request / error helpers | - |

Total: 409 tests.

## Case coverage

Every suite names each case in its test titles (`success:`, `failure:`, `unauthorized:`, `forbidden:`,
`empty data:`, `invalid data:`, `duplicate request:`, `concurrent request:`, `expired subscription:`,
`insufficient balance:`, `provider failure:`, `database failure:`).

| Case | Where it is proven |
|---|---|
| Success | every suite |
| Unauthorized (401) | auth, wallet, store, AI, admin/owner matrix (8 routes) |
| Forbidden (403) | admin/owner matrix (USER and STAFF on 8 routes), CSRF origin on every mutation, not-VIP on AI, not-owner on AI health |
| Empty / invalid data | every route that takes input |
| Duplicate request | points ledger, wallet deposit, orders, wallet checkout, AI credits, owner withdraw, reviews |
| Concurrent request | points (5 parallel debits / same key), wallet checkout (5 parallel payments, last key race, two orders one wallet), AI credits, owner withdraw, sign-up race |
| Expired subscription | `getVipAccess` (past, boundary, statuses), AI credit spend, AI image/video, `/api/vip/status`, owner dashboard `activeVip` query |
| Insufficient balance | points, wallet checkout (402), AI credits (402), owner withdraw |
| Provider failure | wallet deposit (rollback), AI chat/image/video (refund), AI health |
| Database failure | every route: outage -> 503 + Retry-After, unexpected -> 500 with a fixed code and requestId, no internals in the body |

Money / credit tests run against small stateful fakes (serialized transactions that roll back on error,
unique idempotency keys, conditional updates), so double-spend and atomicity are real assertions.
Authorization in `phase19-admin-owner` uses the real `lib/auth.ts` with a signed cookie, so role checks are
proven end to end.

## Defects the tests found (and the fixes)

Each fix is small, and each is pinned by a test that fails on the old code.

| Route | Defect | Fix |
|---|---|---|
| `POST /api/wallet/deposit` | A database failure during the idempotency lookup or the insert threw out of the handler (no JSON) | `createDeposit()` wrapped in `userRouteError` |
| `GET /api/me/orders` | Any failure (incl. DB outage) answered **401**, logging the user out | `userRouteError` |
| `POST /api/me/orders` | Signed-out call answered 400; DB outage / unexpected errors answered 400 | `userRouteError` (401 / 400 / 503 / 500) |
| `POST /api/me/orders/[id]/wallet-checkout` | DB outage answered a plain 500 | 503 + Retry-After via `internalError` |
| `POST /api/ai/chat`, `/image`, `/video`, `GET /api/ai/video/status` | Session lookup (and VIP lookup in image/video) outside `try`: DB failure threw | wrapped, JSON 503 |
| `GET /api/ai/usage` | Session lookup outside `try` | moved inside |
| `GET /api/ai/admin/health` | Signed-in non-owner got 401; session lookup outside `try` | 401 signed out / 403 non-owner; wrapped |
| `GET /api/v1/games` | Purchase check and key-usage update outside `try` | wrapped, JSON 500 |
| `GET/PATCH /api/admin/owner-control` | Every GET failure answered **403**; unexpected PATCH failures answered 400; `null` body threw TypeError | `ownerRouteError`; non-object body treated as `{}` |
| `/api/admin/api-keys`, `/api/admin/api-keys/[id]` | Every failure answered 403 (GET) or 400 (revoke) | `ownerRouteError` |
| `POST /api/owner/withdraw`, `PATCH /api/admin/withdrawals/[id]` | DB outage answered a plain 500 | 503 + Retry-After |

## How these were verified

The sandbox used to write the tests has no network, so `vitest`, `zod`, `next` and `@prisma/client` could not
be installed. The suites were executed with a small vitest-compatible runner and stand-ins for those packages
(409/409 passing, plus 559 existing tests). The same suites were also run against the unfixed routes: 26 failed,
as listed above. Please run `npm test` once in your own environment with the real packages; if a test fails
there only because a stand-in behaved differently from the real package, tell me which one and I will adjust it.
