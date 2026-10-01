# GameVortex Hub — Final Release (2026-10-01)

Built from MERGED-FINAL, with the two source forks reconciled.

## Included
- Wallpaper admin (multi-upload, bulk ops, ZIP export, VIP/FREE, SUPER_ADMIN-only) — from the "Final" fork.
- Mods (public /mods, admin /admin/mods, owner-only API, Prisma migration 20261001110000_add_mods).
- Atomic point deduction (no negative balance) + `npm run audit:points`.
- Gemini image generation + image-to-image editing (server-side key, type/size validation).
- GameVortex AI knows published Mods; Mods links restored in site header and admin nav.

## Fixes applied in this pass
1. Local wallpapers (/wallpapers/...) are now read from disk (path-traversal guarded) with a fallback to the configured site origin; the old http://127.0.0.1 (no port) fetch is gone. ZIP export uses the same loader.
2. VIP wallpaper media is served `private, no-store` (public CDN cache only for FREE items).
3. `db:seed` runs through `npx --yes tsx` (tsx is not in the lockfile; adding it to package.json alone would break `npm ci`).

## Notes
- `lint` is `tsc --noEmit` because `next lint` no longer exists in Next 16.
- Optional env: NEXT_PUBLIC_SITE_URL (used only by the wallpaper fetch fallback; defaults to http://127.0.0.1:3000, matching the Dockerfile port).

## NOT verified here (no npm registry access)
npm ci, typecheck, build, prisma validate/migrate, live DB, payments, Gemini, trading.
Run: npm ci → db:validate → db:generate → typecheck → audit:points → test → build → review migration → db:deploy.
