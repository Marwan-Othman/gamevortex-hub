# GameVortex Hub V6 — Platform Completion

This release completes the major internal platform layers that can be safely implemented without external production credentials.

## Included
- Commerce domain: products, orders, payments, entitlements.
- Idempotent order creation.
- Generic HMAC-signed payment webhook contract.
- Provider abstraction for future Stripe/PayPal/etc. adapters.
- Refund state handling and entitlement revocation path.
- User content reporting.
- Admin moderation queue and moderation audit trail.
- Hardened admin dashboard with authentication.
- Private health diagnostics while keeping public health minimal.
- Structured observability helpers.
- Database migration for platform completion.
- Smoke-check script and database validation scripts.

## Deliberately not faked
- No fake payment provider is shipped.
- No fake Steam/PlayStation/Xbox credentials or OAuth tokens are embedded.
- No fake email/SMS provider is claimed to be connected.
- No external AI key is embedded.
- Real-time WebSocket infrastructure is represented by domain events/notifications but requires a deployment service or WebSocket provider.

## Production activation checklist
1. Set DATABASE_URL and AUTH_SECRET.
2. Deploy migrations.
3. Configure a real payment provider adapter and PAYMENT_WEBHOOK_SECRET.
4. Configure object storage/CDN for game media.
5. Configure email provider for verification/reset emails.
6. Add external gaming OAuth credentials only in the deployment secret store.
7. Run `npm run db:validate`, `npm run typecheck`, `npm run build`, and smoke tests in CI.
8. Enable backups, monitoring, alerting and log retention.
