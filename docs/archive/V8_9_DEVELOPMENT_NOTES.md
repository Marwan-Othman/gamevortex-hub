# GameVortex Hub V8.9 — Reviews & Ratings

## Added
- User review editor on the game details page.
- Existing review is loaded for the authenticated user and can be updated.
- Rating is constrained to 1–5 and text to 2000 characters client/server side.
- Review API GET endpoint returns only the authenticated user's own review.
- Existing POST endpoint keeps one-review-per-user-per-game semantics and recalculates `ratingAverage`/`ratingCount` transactionally.
- Review save remains rate-limited and audited by the existing API/security layer.

## Validation
- Source-level structure checked after edits.
- Full production build is intentionally not claimed because this environment does not have a completed dependency install/lockfile or PostgreSQL runtime.
