# AI Media Provider Hardening - 2026-09-30

The application schema now uses `AiMediaProvider.INTERNAL` only.

A new Prisma migration was added:

`prisma/migrations/20260930110000_remove_legacy_ai_media_providers/migration.sql`

It safely converts any existing `AiMediaJob.provider` values to `INTERNAL` and recreates the PostgreSQL enum with only `INTERNAL`.

## Important

Older Prisma migrations may still contain historical `FAL` / `MINIMAX` enum definitions. They are intentionally not rewritten because changing an already-applied migration changes its checksum and can break production migration history.

The runtime application code does not use those providers.

Before production deployment, run:

```bash
npm run db:validate
npm run db:status
npm run db:deploy
npm run typecheck
npm run build
```

If `db:deploy` reports a historical migration conflict, stop there and reconcile the migration history rather than editing an already-applied migration.
