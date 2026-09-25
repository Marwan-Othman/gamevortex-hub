# GameVortex Hub V10.1 — requested modifications

## Owner
- Owner display name: `marwan hoshiya`
- Owner email: `marwan.hoshiya.2002@gmail.com`
- Owner username default: `marwan_hoshiya`
- Owner account remains `SUPER_ADMIN`.
- The owner password is intentionally NOT stored in source control or this ZIP. Set it through `OWNER_INITIAL_PASSWORD` as a deployment secret before running `npm run production:seed` or `npm run production:bootstrap`.
- Passwords are stored as scrypt hashes; plaintext passwords are never returned by the API.

## Privacy
- `/api/auth/me` returns the authenticated user's own email only.
- Public gamer/profile data does not expose account passwords or password hashes.
- Password hashes are never serialized to client responses.

## Payments
Real gateway integrations were added/extended:
- Stripe Checkout with Stripe webhook verification.
- PayPal Checkout with PayPal OAuth, order creation, approval URL, and PayPal webhook signature verification.
- Existing HMAC provider remains available for custom integrations.

Production configuration is required:
- Stripe: `PAYMENT_PROVIDER=stripe`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- PayPal: `PAYMENT_PROVIDER=paypal`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENVIRONMENT=live`, `PAYPAL_WEBHOOK_ID`.
- Never put live credentials directly into source files.

## UI
- Added bilingual RTL/LTR language switcher.
- Added the requested Glitch loading/title indicator.
- Added a bilingual Arabic/English notification component.
- Added RTL/LTR spacing and alignment CSS.
- Language selection is persisted in `localStorage`.

## Validation
The archive is source-modified, but a full production build requires installing dependencies and providing a real PostgreSQL database plus production environment secrets. This environment could not complete `npm ci` within the available execution window, so no claim of a successful `next build` is made here.
