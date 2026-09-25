# GameVortex Hub V9.3 — Real Environment

This release turns the V9.2 codebase into a reproducible production environment.

## Included
- PostgreSQL 16 with persistent Docker volume.
- Production application container.
- Automatic Prisma migration deployment at application startup.
- Safe one-time owner bootstrap using `OWNER_EMAIL` and `OWNER_INITIAL_PASSWORD`.
- Refusal to create a second `SUPER_ADMIN`.
- Production environment template with HTTPS requirement.
- Application and database health checks.
- PostgreSQL backup script.

## Start
1. Copy `.env.production.example` to `.env.production`.
2. Create a strong `POSTGRES_PASSWORD` in your shell or deployment secret store.
3. Replace every placeholder in `.env.production`.
4. Run `docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build`.
5. Verify `/api/health`.

Do not commit `.env.production`, owner passwords, API keys, payment secrets, or wallet secrets.

## Still requires real external providers
- HTTPS reverse proxy/domain.
- Payment provider credentials and webhook URL.
- AI provider credentials.
- Quran provider/license-approved audio sources.
- Real payout provider before enabling owner withdrawals.
