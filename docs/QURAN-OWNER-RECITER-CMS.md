# Quran Owner Reciter CMS

The owner can add, edit, activate/deactivate and delete Quran reciters from `/admin/quran`.

Each reciter has an independent legal/official source URL, provider, audio base URL, license status and verification state. Changes are protected by `requireOwner()` and recorded in `AuditLog`.

## Safety rules
- HTTPS is required for source, license and audio URLs.
- A reciter can be marked VERIFIED only by the owner route.
- The UI never fabricates a provider or audio URL.
- `sourceVerificationStatus` remains the authoritative publication gate for public Quran reciters.
- Do not re-host copyrighted recordings without permission.

## Production recommendation
Keep the source URL, permission/license evidence URL, verification date and verifier identity. Run periodic source health checks and license reviews before keeping a reciter active.
