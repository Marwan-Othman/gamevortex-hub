import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { logSystemError } from "@/lib/observability";
import { ConfiguredPaymentProvider } from "@/lib/payments";

/*
 * GameVortex own API — Master Task Plan Section 3, item 2:
 * "لا تُتاح للعامة، تُطلب عبر التواصل أو تُشترى بسعر ثابت ($10)،
 *  وتظهر تلقائيًا بعد الدفع".
 *
 * Deliberately NOT modeled as a GameProduct/Order (see schema.prisma
 * comment on ApiKeyPurchase) — a fully separate, isolated purchase
 * flow that cannot affect the existing game-catalog checkout at all.
 */

function getApiKeyPriceCents(): number {
  const raw = process.env.API_KEY_PRICE_CENTS;
  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return 1000; // $10.00 default
  }

  return parsed;
}

export async function POST(req: NextRequest) {
  const blocked = await guardMutation(
    req,
    "api-keys:checkout",
    5,
  );

  if (blocked) {
    return blocked;
  }

  try {
    const user = await requireUser();

    // One PENDING purchase at a time per user — avoids piling up
    // abandoned checkout sessions.
    const existingPending =
      await db.apiKeyPurchase.findFirst({
        where: { userId: user.id, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      });

    const priceCents = getApiKeyPriceCents();

    const purchase =
      existingPending ??
      (await db.apiKeyPurchase.create({
        data: {
          userId: user.id,
          priceCents,
          idempotencyKey: randomUUID(),
        },
      }));

    const origin =
      req.headers.get("origin") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://gamevortex.example.com";

    const provider = new ConfiguredPaymentProvider();

    const payment = await provider.createPayment({
      orderId: purchase.id,
      amountCents: purchase.priceCents,
      currency: purchase.currency.toLowerCase(),
      returnUrl: `${origin}/account/api-keys?purchase=${purchase.id}`,
    });

    await db.apiKeyPurchase.update({
      where: { id: purchase.id },
      data: {
        provider: payment.provider,
        providerPaymentId: payment.paymentId,
      },
    });

    return NextResponse.json({
      purchaseId: purchase.id,
      checkoutUrl: payment.checkoutUrl,
      priceCents: purchase.priceCents,
    });
  } catch (error) {
    await logSystemError(
      "api-keys.checkout",
      error,
      {},
    );

    return NextResponse.json(
      { error: "CHECKOUT_FAILED" },
      { status: 500 },
    );
  }
}
