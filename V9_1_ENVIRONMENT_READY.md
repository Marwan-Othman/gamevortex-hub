# GameVortex Hub V9.1 — Environment Ready

This release adds a reproducible container/database setup around V9.0.

## Included
- `Dockerfile` for a Node 22 production image.
- `docker-compose.yml` for PostgreSQL 16.
- `scripts/setup-environment.mjs` to create a safe local `.env.local` with a random AUTH_SECRET.

## Important validation boundary
A `package-lock.json` is still required before claiming fully reproducible `npm ci` builds. The current execution environment could not reach the npm registry, so no false lockfile or Production-Validated claim is included.

## Intended flow
1. `npm install`
2. `node scripts/setup-environment.mjs`
3. `docker compose up -d postgres`
4. `npm run db:migrate`
5. `npm run production:validate`
