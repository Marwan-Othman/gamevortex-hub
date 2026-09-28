# GameVortex Hub — V9.4 Feature Matrix

| Feature | V9.4 status | Production requirement |
|---|---|---|
| Games catalog | PARTIAL | Populate/verify a real licensed catalog |
| Game Library | IMPLEMENTED_CORE | E2E regression coverage |
| Favorites / Wishlist | IMPLEMENTED_CORE | E2E regression coverage |
| Gamer Profiles / Follow / Feed | IMPLEMENTED_CORE | E2E regression coverage |
| Reviews / moderation | IMPLEMENTED_CORE | E2E + abuse testing |
| Achievements / XP / rankings | IMPLEMENTED_CORE | Anti-abuse/anti-cheat rules |
| Recommendations | IMPLEMENTED_CORE | Existing site ranking logic |
| GameVortex AI Chat | SELF_HOSTED_RUNTIME | Run Ollama and install the configured local model |
| GameVortex AI Image/Video | NOT_IMPLEMENTED | No media generation routes are present |
| AI Smart Search | NOT_IMPLEMENTED | No AI search endpoint is present |
| AI Recommendations | NOT_IMPLEMENTED | No provider integration is present |
| AI Moderation | NOT_IMPLEMENTED | Use existing human moderation workflow |
| Payments | IMPLEMENTED_PROVIDER | Configure Stripe or compatible provider |
| Payment webhooks | IMPLEMENTED | Configure signing secret and provider webhook |
| Owner Wallet | IMPLEMENTED_CORE | Financial reconciliation in operations |
| Owner Withdrawal | PROVIDER_READY | Configure payout provider; run processor |
| Email | IMPLEMENTED_PROVIDER | Configure Resend |
| Steam import foundation | IMPLEMENTED_PROVIDER | Configure Steam API key and OAuth/token flow |
| Xbox / PlayStation adapters | CONFIGURABLE | Supply approved provider endpoints/credentials |
| Quran reciters | IMPLEMENTED_CORE | Verify licenses/sources before activation |
| SEO | IMPLEMENTED | Continue per-page structured data as catalog grows |
| Security headers / CSRF / RBAC | IMPLEMENTED_CORE | External security assessment |
| Rate limiting | IMPLEMENTED | Upstash recommended for multi-instance |
| Observability | BASELINE | Add external error/metrics platform in deployment |
| Production Docker | IMPLEMENTED | Run full validation with real environment |
| Reproducible npm install | BLOCKED_BY_SOURCE_ARCHIVE | Generate `package-lock.json` with registry access via `npm run production:bootstrap` |
| Full production build | ENVIRONMENT_DEPENDENT | Requires installed dependencies and PostgreSQL |

## Important
External credentials and paid-provider accounts cannot be safely embedded in a ZIP archive. V9.4 therefore implements the server-side adapters and strict configuration checks instead of shipping fake credentials.
