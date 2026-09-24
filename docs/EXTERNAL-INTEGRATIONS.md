# External integrations contract

GameVortex intentionally ships provider interfaces instead of fake credentials.

- Payments: `lib/payments.ts`
- Gaming accounts: `lib/integrations/gaming.ts`
- Email: `lib/integrations/email.ts`

Production adapters should be injected from environment configuration and must verify OAuth state, webhook signatures, scopes, token expiry, and provider-specific rate limits.
