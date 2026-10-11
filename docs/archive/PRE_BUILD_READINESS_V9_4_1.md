# GameVortex Hub V9.4.1 — Pre-Build Readiness

## Fixes applied in this archive

- Fixed `production:bootstrap`: a clean checkout now generates `package-lock.json`, runs `npm ci`, then executes environment validation and the production validation chain.
- Confirmed the Gamer Dashboard is a Client Component.
- Added the missing `/rankings` page used by the home page.
- Fixed home-page player links from `/gamers/:username` to the existing `/gamer/:username` route.
- Added numeric validation for owner-points configuration and an optional first-owner bootstrap check.
- Removed the stale generated `tsconfig.tsbuildinfo` artifact and ignore future `*.tsbuildinfo` files.

## Still required before calling the project Production-Validated

- [ ] Run the bootstrap on a machine with registry access so `package-lock.json` and `node_modules` are actually generated.
- [ ] Configure real production values in `.env.production` / secret manager.
- [ ] Use a real PostgreSQL production database and run migrations.
- [ ] Run `npm run production:bootstrap` successfully.
- [ ] Start the service and verify `/api/health`.
- [ ] Test login, RBAC, library, favorites, wishlist, reviews, moderation and owner flows.
- [ ] If payments are enabled, test Stripe/webhook signatures and idempotency in staging.
- [ ] If payouts are enabled, test provider settlement and failure/refund paths before enabling withdrawals.
- [ ] Verify every published game/audio source and its license.
- [ ] Run dependency/security audit after the lockfile is generated.
- [ ] Run E2E, load and backup/restore tests; these are not included as automated suites in the archive.

## Important limitation

This archive has not been truthfully marked as build-validated: the supplied bundle has no `package-lock.json` or `node_modules`, and dependency installation requires registry access.
