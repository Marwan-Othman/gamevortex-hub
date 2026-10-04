# GameVortex Wallet — Visa Top-Up Setup

## Purpose

GameVortex Wallet supports a secure card top-up flow through the existing payment-provider abstraction. For Visa card payments, use Stripe in production.

The application creates the wallet deposit first and credits the user's wallet only after the verified payment webhook reports a successful payment. The browser never submits raw card details to GameVortex.

## Production configuration

Set these server-side environment variables in Vercel:

```text
PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=<Stripe secret key>
STRIPE_WEBHOOK_SECRET=<Stripe webhook signing secret>
APP_ORIGIN=https://gamevortex-hub.vercel.app
```

Do not prefix payment secrets with `NEXT_PUBLIC_`. Never commit them to GitHub.

## Stripe webhook

Configure a Stripe webhook endpoint pointing to:

```text
https://gamevortex-hub.vercel.app/api/payments/webhook
```

The endpoint must use the Stripe signing secret configured in `STRIPE_WEBHOOK_SECRET`.

The wallet deposit handler validates the deposit amount and provider payment ID, is idempotent, and credits the wallet only after the verified webhook reports `SUCCEEDED`.

## Visa behavior

Stripe supports Visa card payments through its card payment flow. GameVortex uses Stripe Checkout, so card information is collected by Stripe rather than by GameVortex. 3D Secure authentication can also be handled by Stripe Checkout when required.

## Verification procedure

1. Configure Stripe in test mode first.
2. Set `PAYMENT_PROVIDER=stripe` and the test credentials in Vercel Preview/Test environment.
3. Configure the webhook for the preview environment.
4. Open `/wallet` while logged in.
5. Select an amount of at least `$1.00`.
6. Confirm that the hosted checkout page offers card payment.
7. Complete a Stripe test card payment.
8. Verify that the wallet balance changes only after the webhook succeeds.
9. Verify the wallet transaction has `type=DEPOSIT` and the correct amount.
10. Verify a repeated webhook does not credit the wallet twice.
11. Only after all checks pass, configure the live Stripe credentials and live webhook.

## Trading relationship

Wallet funds and Trading Allocation are separate. Funding the wallet does not automatically start a trade or allocate funds to trading. The existing Owner approval, allocation, Risk Manager, Shariah Guard, exchange preflight, and live-trading gates remain mandatory.

## Important

Visa is a card network, not the payment processor itself. GameVortex therefore does not connect directly to Visa. Stripe is the payment processor/acquirer integration used by the application for online card acceptance.
