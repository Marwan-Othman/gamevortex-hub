# Integration Contracts

The merged project intentionally does not fake external services.

Expected environment variables when real providers are connected:

- `AUTH_PROVIDER`
- `AI_PROVIDER`
- `PAYMENT_PROVIDER`
- `PAYOUT_PROVIDER`
- `STEAM_API_KEY`
- `DATABASE_URL`

Until configured and tested, these capabilities must report `NOT_CONFIGURED` / `NEEDS_INTEGRATION`.
