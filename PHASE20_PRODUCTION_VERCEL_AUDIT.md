# Phase 20 - Production / Vercel

## IMPORTANT: what could and could not be run
`npm run build` was NOT executed. The audit sandbox has no network access, so `npm ci` failed with
ENOTFOUND (registry.npmjs.org). `next build` also downloads the Google font used in `app/layout.tsx`.
Run this on your machine / Vercel and send me the first error if any:

    npm ci && npm run build

What WAS executed (no dependencies needed): `test:source`, `test:owner-policy`, `test:env-contract`,
`validate:env` (with simulated production values).

## Defects found and fixed
| Area | Defect | Fix |
|---|---|---|
| Environment | `npm run test:env-contract` FAILED: `POSTGRES_PASSWORD` is read by `scripts/validate-env.mjs` but missing from `.env.example` and `.env.production.example` | Added `POSTGRES_PASSWORD=` (Docker-only, empty on Vercel) to both |
| Environment | `validate-env` was silent when running on Vercel with the in-memory rate limiter (each serverless instance has its own counters) | Warning when `VERCEL` is set and `RATE_LIMIT_STORE` is not `upstash` |
| Database | No hint when `DATABASE_URL` is not a pooled URL (connection exhaustion on serverless) | Warning on Vercel when the URL does not look pooled |
| Tests | Env-contract script would flag the platform variable `VERCEL` | Added to the ignored runtime vars next to `VERCEL_URL` |

## Checked and OK (static review)
- **Node**: `engines.node` is `>=20.9 <23`, so Vercel selects Node 22; Next 16 needs >=20.9.
- **Build script**: `npm run db:generate && next build`; `postinstall` also runs `prisma generate`.
- **Prisma**: single client in `lib/prisma.ts`; PostgreSQL provider; 61 migrations + `migration_lock.toml`.
- **Static generation**: root layout calls `cookies()` so every page renders dynamically, and 29 of the 33
  data pages also set `force-dynamic`; nothing queries the database at build time. `sitemap.ts` is dynamic.
- **API routes**: all 127 route handlers either set `dynamic = "force-dynamic"` or read the request/cookies
  (so none is prerendered at build). Cron routes are `nodejs`, `maxDuration = 60`, protected by `CRON_SECRET`.
- **Serverless file system**: the only disk reads are wallpapers under `public/`, and both
  (`lib/wallpaper-delivery.ts`, `/api/wallpapers/[id]/download`) already fall back to fetching the file
  from the site origin because `public/` is not in the function bundle on Vercel.
- **Uploads**: admin uploads use Vercel Blob client uploads (`handleUpload`), so the 4.5 MB serverless
  body limit does not apply.
- **Images/CSP/headers**: no `next/image` remote hosts in use; CSP allows `https:` connections.
- **Cron**: `vercel.json` has two daily crons matching real routes; Vercel sends `Authorization: Bearer $CRON_SECRET`.
- **Middleware**: none (nothing to migrate to `proxy.ts` for Next 16).

## What you must set in the Vercel dashboard
1. `DATABASE_URL` = POOLED connection string (Neon `-pooler` / Supabase pgbouncer, `?pgbouncer=true&connection_limit=1`).
2. Run migrations from your machine or CI against the DIRECT url: `npx prisma migrate deploy`
   (the Vercel build does not run migrations on purpose).
3. `AUTH_SECRET` (32+ random chars), `APP_ORIGIN` (https, no path), `NEXT_PUBLIC_SITE_URL`,
   `CRON_SECRET` (16+ chars), `DIGITAL_KEY_ENCRYPTION_SECRET` (32+ chars) if payments are on.
4. `RATE_LIMIT_STORE=upstash` + `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`.
5. `TRUSTED_PROXY_HOPS=0`, `GAMEVORTEX_LIVE_TRADING_ENABLED=false` until you are ready.
6. `GEMINI_API_KEY` and `MANUS_API_KEY` (required by `validate-env` in production), `BLOB_READ_WRITE_TOKEN`
   (or connect the Blob store).
7. `maxDuration = 300` on AI routes needs Fluid Compute / a plan that allows 300s.
