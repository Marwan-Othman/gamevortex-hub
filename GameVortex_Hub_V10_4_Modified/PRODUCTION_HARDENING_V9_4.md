# GameVortex Hub V9.4 — Production Hardening

This revision keeps the V9.3 application/data model and hardens the production path.

## Implemented
- Distributed rate limiting via optional Upstash Redis REST with safe local fallback.
- Payment adapter with Stripe Checkout support and signed Stripe webhook verification.
- Payment idempotency at `(provider, providerPaymentId)` database level.
- Resend email adapter.
- Steam Web API integration plus configurable Xbox/PlayStation HTTP adapters.
- OpenAI-compatible server-side AI chat adapter with input limits and a security system prompt.
- Owner payout adapter and a safe batch payout processor with reservation/refund accounting.
- Health endpoint with database and integration configuration visibility for private admin checks.
- Dynamic game metadata/canonical URLs/Open Graph.
- Environment validation for payment, payout, email, AI and distributed rate-limit settings.
- Production bootstrap script that generates the lockfile on a machine with registry access, then executes the full validation chain.
- Payment webhook replay/idempotency protection and amount verification.

## External credentials still required
A source archive cannot invent provider credentials. To activate real external services, configure the provider secrets in `.env.production`:
- Stripe: `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `PAYMENT_WEBHOOK_SECRET`.
- Resend: `RESEND_API_KEY`, `EMAIL_FROM`.
- Steam: `STEAM_API_KEY`.
- AI: `AI_PROVIDER_BASE_URL`, `AI_PROVIDER_API_KEY`, `AI_MODEL`.
- Owner payout: `PAYOUT_PROVIDER`, `PAYOUT_PROVIDER_BASE_URL`, `PAYOUT_PROVIDER_SECRET`, and the destination wallet.
- Multi-instance rate limiting: `RATE_LIMIT_STORE=upstash`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

## Validation
Run `npm run production:bootstrap` on an environment with internet access to create `package-lock.json`, install dependencies, migrate PostgreSQL, typecheck, build Next.js, and execute the smoke test.
