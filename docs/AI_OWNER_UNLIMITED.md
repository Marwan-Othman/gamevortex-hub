# GameVortex AI — Owner Unlimited Entitlements

## Policy

الحساب الذي يحمل:

`role = SUPER_ADMIN`

يُعامل كـ Owner VIP دائم، ويحصل على:

- Chat: Unlimited
- Image generation: Unlimited
- Video generation: Unlimited

## Implementation

- `lib/vip.ts` derives Owner VIP from the database role.
- `lib/vip-subscriptions.ts` exposes unlimited AI entitlements for SUPER_ADMIN.
- `lib/vip-credits.ts` records Owner usage without decrementing subscription/free credits.
- `/api/ai/chat` uses the same server-side entitlement check.
- `/api/ai/image` uses the same server-side entitlement check.
- `/api/ai/video` uses the same server-side entitlement check.
- `/api/vip/status` reports `isOwner=true` and unlimited values.
- `app/ai/AICreditsPanel.tsx` displays `∞` for Owner.

## Safety boundary

Unlimited means the GameVortex quota is not depleted. External provider limits, billing, provider outages, model availability, and provider policies still apply.

The system must never expose provider API keys to the browser.
