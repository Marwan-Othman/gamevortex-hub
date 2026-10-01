# GameVortex Hub — Development Upgrade

## What changed
- Added request rate limiting for public API surfaces and mutations.
- Added Origin / Sec-Fetch-Site CSRF guard for state-changing requests.
- Added Vortex Score engine for discovery and ranking.
- Added paginated Games API.
- Added Game Details API and page by slug.
- Added authenticated game review create/update endpoint with aggregate rating maintenance.
- Added stronger database indexes for reviews, library items and audit logs.
- Added production metadata, navigation and a redesigned responsive home/games experience.
- Added a public-safe direction for health and integration work without inventing external providers.

## Important limitation
The current rate limiter is process-local memory. For multi-instance production deployment it should be replaced with a shared Redis/Upstash implementation.

## Next recommended phase
1. Distributed rate limiting.
2. Full RBAC for STAFF roles.
3. Password reset/email verification.
4. Gamer profiles, XP and achievements.
5. Notifications and moderation.
6. AI recommendations and external game catalog integrations.
7. Real payment/payout provider with webhook reconciliation.
