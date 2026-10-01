# Integration Contracts

The merged project intentionally does not fake external services.

External billing and social-login integrations still need their own credentials. GameVortex AI does not use third-party AI inference APIs; it connects only to a self-hosted Ollama-compatible chat runtime configured server-side. Image/video generation is not implemented.

Expected environment variables for external integrations:

- `AUTH_PROVIDER`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `APPLE_CLIENT_ID` / `APPLE_TEAM_ID` / `APPLE_KEY_ID` / `APPLE_PRIVATE_KEY`
- `PAYMENT_PROVIDER`
- `PAYOUT_PROVIDER`
- `STEAM_API_KEY`
- `DATABASE_URL`

Until configured and tested, these capabilities must report `NOT_CONFIGURED` / `NEEDS_INTEGRATION`.
