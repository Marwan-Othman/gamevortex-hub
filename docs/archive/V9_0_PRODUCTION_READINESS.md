# GameVortex Hub V9.0 — Production Readiness

## Completed hardening
- Added periodic cleanup to the process-local rate-limit map.
- Rate limiting now rejects before incrementing beyond the configured limit.
- Added PostgreSQL URL validation to the environment gate.
- Added strict APP_ORIGIN URL validation and production HTTPS enforcement.
- Extended smoke checks to cover health, auth, games, reviews, library, notifications, orders, webhook, reports, and moderation routes.
- Preserved the existing authentication, Prisma, payments, and application structure.

## Not yet production-validated
The full validation command remains:

`npm run production:validate`

It requires network access for dependencies and a reachable PostgreSQL database with valid production environment variables. This package does **not** claim that `next build` or database migrations have passed in this environment.

## Deployment note
The current rate limiter is process-local. For multiple application instances, replace it with a shared Redis/Upstash-backed limiter before relying on it as a global abuse-control boundary.
