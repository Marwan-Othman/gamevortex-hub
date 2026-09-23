import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { rateLimitAsync, clientKey } from "@/lib/security";
import { logSystemError } from "@/lib/observability";
import { generateApiKey } from "@/lib/api-keys";
import {
  normalizeStripe,
  normalizePayPal,
  normalizeGeneric,
  type NormalizedEvent,
} from "@/app/api/payments/webhook/route";
import {
  verifyStripeWebhook,
  verifyPayPalWebhook,
  verifyHmacWebhook,
} from "@/lib/payments";

export const runtime = "nodejs";

/*
 * GameVortex own API — Master Task Plan Section 3, items 2 & 3.
 *
 * A SEPARATE webhook endpoint from /api/payments/webhook on purpose:
 * that endpoint's completion flow (deliverGameKeys) throws for any
 * product that isn't a GAME_KEY/CODE item, so an API-key purchase
 * (which is not an Order at all) must never be routed through it.
 *
 * Setup required in the payment provider dashboard (documented in
 * PROGRESS_TRACKER.md): register THIS route's URL as an additional
 * webhook endpoint — providers support multiple endpoints per
 * account, each with its own signing secret.
 *   Stripe:  API_KEYS_STRIPE_WEBHOOK_SECRET
 *   PayPal:  reuses PAYPAL_WEBHOOK_ID (see lib/payments.ts)
 */

async function verifySignature(
  provider: string,
  rawBody: string,
  signature: string,
  headers: Record<string, string>,
): Promise<boolean> {
  if (provider === "stripe") {
    return verifyStripeWebhook(
      rawBody,
      signature,
      process.env.API_KEYS_STRIPE_WEBHOOK_SECRET ||
        process.env.STRIPE_WEBHOOK_SECRET ||
        process.env.PAYMENT_WEBHOOK_SECRET ||
        "",
    );
  }

  if (provider === "paypal") {
    return verifyPayPalWebhook(rawBody, headers);
  }

  return verifyHmacWebhook(rawBody, signature);
}

function parseEvent(raw: unknown): NormalizedEvent | null {
  return (
    normalizeStripe(raw) ||
    normalizePayPal(raw) ||
    normalizeGeneric(raw)
  );
}

export async function POST(request: NextRequest) {
  const limited = await rateLimitAsync(
    clientKey(request, "api-keys:webhook"),
    120,
    60_000,
  );

  if (!limited.allowed) {
    return NextResponse.json(
      { error: "RATE_LIMITED" },
      {
        status: 429,
        headers: {
          "Retry-After": String(limited.retryAfter),
        },
      },
    );
  }

  const rawBody = await request.text();

  const signature =
    request.headers.get("stripe-signature") ||
    request.headers.get("x-payment-signature") ||
    "";

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let raw: unknown;

  try {
    raw = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "INVALID_JSON" },
      { status: 400 },
    );
  }

  const event = parseEvent(raw);

  if (!event) {
    // Not an event this endpoint understands — acknowledge quietly
    // rather than erroring, same convention as the main webhook.
    return NextResponse.json({ received: true });
  }

  const verified = await verifySignature(
    event.provider,
    rawBody,
    signature,
    headers,
  );

  if (!verified) {
    return NextResponse.json(
      { error: "INVALID_SIGNATURE" },
      { status: 401 },
    );
  }

  try {
    // event.orderId here is actually the ApiKeyPurchase.id — the
    // generic `orderId` field name comes from lib/payments.ts's
    // provider-agnostic PaymentCreateInput, it's just an id string.
    const purchase = await db.apiKeyPurchase.findUnique({
      where: { id: event.orderId },
    });

    if (!purchase) {
      // Not one of ours (likely a normal Order event delivered to
      // this endpoint by mistake) — acknowledge and ignore.
      return NextResponse.json({ received: true });
    }

    if (purchase.status !== "PENDING") {
      return NextResponse.json({ received: true });
    }

    if (event.status === "FAILED") {
      await db.apiKeyPurchase.update({
        where: { id: purchase.id },
        data: {
          status: "FAILED",
          provider: event.provider,
          providerPaymentId: event.paymentId,
        },
      });

      return NextResponse.json({ received: true });
    }

    if (event.status !== "SUCCEEDED") {
      return NextResponse.json({ received: true });
    }

    if (event.amountCents !== purchase.priceCents) {
      await logSystemError(
        "api-keys.webhook.amount-mismatch",
        new Error("AMOUNT_MISMATCH"),
        {
          metadata: {
            purchaseId: purchase.id,
            expected: purchase.priceCents,
            received: event.amountCents,
          },
        },
      );

      return NextResponse.json(
        { error: "AMOUNT_MISMATCH" },
        { status: 400 },
      );
    }

    const { plainKey, keyHash, keyPrefix } =
      generateApiKey();

    await db.$transaction(async (tx) => {
      const apiKey = await tx.apiKey.create({
        data: {
          userId: purchase.userId,
          keyHash,
          keyPrefix,
          plainKeyOnce: plainKey,
        },
      });

      await tx.apiKeyPurchase.update({
        where: { id: purchase.id },
        data: {
          status: "PAID",
          provider: event.provider,
          providerPaymentId: event.paymentId,
          apiKeyId: apiKey.id,
        },
      });
    });

    return NextResponse.json({ received: true });
  } catch (error) {
    await logSystemError(
      "api-keys.webhook",
      error,
      {},
    );

    return NextResponse.json(
      { error: "WEBHOOK_PROCESSING_FAILED" },
      { status: 500 },
    );
  }
}
