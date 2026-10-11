# GameVortex Hub — Stabilization Progress

## What is complete in this revision

- Prisma schema validation, Prisma client generation, TypeScript checking, unit tests, and production build all pass locally.
- The project now uses a reproducible `package-lock.json` and `npm ci` workflow.
- A CI quality gate has been added under `.github/workflows/ci.yml`.
- Runtime dependency audit reports zero high-severity vulnerabilities after updating Next.js and Prisma dependencies.
- The marketplace now exposes only verified, published, supplier-verified `GAME_KEY` products using code delivery.
- Order creation validates sellability server-side, aggregates duplicate quantities, prevents mixed currencies, and validates stock.
- Checkout revalidates order eligibility and reuses an existing payment action where possible.
- Customers have a `/orders` page and can reveal delivered game keys only after a successful payment.
- Digital game keys are encrypted before storage, identified by a non-reversible fingerprint, and tracked as `AVAILABLE`, `DELIVERED`, or `REVOKED`.
- An owner-only API endpoint has been added for importing encrypted keys: `POST /api/admin/products/:id/keys`.
- The payment webhook atomically assigns available keys to paid order items and revokes delivered keys and entitlements on refund.
- Content-Security-Policy and other browser security headers are applied through `next.config.mjs`.

## Required staging setup before enabling payments

1. Create a new PostgreSQL staging database and save its URL as `DATABASE_URL`.
2. Set strong values for `AUTH_SECRET`, `PAYMENT_WEBHOOK_SECRET`, and `DIGITAL_KEY_ENCRYPTION_SECRET`.
3. Use a payment provider test account only. Set `PAYMENT_PROVIDER`, the provider secret, and `APP_ORIGIN` to the staging HTTPS address.
4. Apply database migrations with `npm run db:migrate`.
5. Create one verified and published game plus one supplier-verified `GAME_KEY` product.
6. Import test keys through the owner-only endpoint. Never put real keys in source files, browser requests, or logs.
7. Register `/api/payments/webhook` as the provider's HTTPS webhook endpoint and test a successful payment, a duplicate event, a failed event, and a refund.
8. Confirm that a customer sees the key in `/orders` exactly once after a successful webhook.

## Commands for a clean check

```bash
npm ci
npm audit --omit=dev --audit-level=high
npm run db:validate
npm run db:generate
npm run typecheck
npm test
npm run build
```

## Important limits of this revision

This source revision is ready for **staging validation**, not for immediate live commercial use. A real deployment still requires a hosted HTTPS domain, a PostgreSQL staging database, a payment provider test account, a verified supplier process, legal terms, backup-and-restore testing, and end-to-end payment tests using provider-signed webhook events.
