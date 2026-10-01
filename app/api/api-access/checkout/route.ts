import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { ConfiguredPaymentProvider } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ idempotencyKey: z.string().trim().min(16).max(100) });
const API_ACCESS_PRICE_CENTS = 1000;

function buildReturnUrl(purchaseId: string) {
  const origin = process.env.APP_ORIGIN?.trim();
  if (!origin) throw new Error("APP_ORIGIN_NOT_CONFIGURED");
  const url = new URL("/payment/return", origin);
  url.searchParams.set("target", "api");
  url.searchParams.set("reference", purchaseId);
  return url.toString();
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "api-access:checkout", 5);
  if (blocked) return blocked;

  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

    const existing = await db.apiAccessPurchase.findUnique({ where: { idempotencyKey: parsed.data.idempotencyKey } });
    if (existing) {
      if (existing.userId !== user.id) return NextResponse.json({ error: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
      if (existing.status === "PENDING" && existing.providerCheckoutUrl) {
        return NextResponse.json({ data: { id: existing.id, status: existing.status, checkoutUrl: existing.providerCheckoutUrl } });
      }
      return NextResponse.json({ error: existing.status === "SUCCEEDED" ? "API_ACCESS_ALREADY_PURCHASED" : "CHECKOUT_ALREADY_USED" }, { status: 409 });
    }

    const activeAccess = await db.apiAccessPurchase.findFirst({ where: { userId: user.id, status: "SUCCEEDED" }, select: { id: true } });
    if (activeAccess) return NextResponse.json({ error: "API_ACCESS_ALREADY_PURCHASED" }, { status: 409 });

    const provider = new ConfiguredPaymentProvider();
    if (!provider.name) return NextResponse.json({ error: "PAYMENT_PROVIDER_NOT_CONFIGURED" }, { status: 503 });

    const purchase = await db.apiAccessPurchase.create({
      data: { userId: user.id, amountCents: API_ACCESS_PRICE_CENTS, currency: "USD", idempotencyKey: parsed.data.idempotencyKey },
    });

    try {
      const payment = await provider.createPayment({
        orderId: purchase.id,
        amountCents: purchase.amountCents,
        currency: purchase.currency,
        returnUrl: buildReturnUrl(purchase.id),
      });
      if (!payment.checkoutUrl) throw new Error("PAYMENT_CHECKOUT_URL_MISSING");
      const updated = await db.apiAccessPurchase.update({
        where: { id: purchase.id },
        data: { provider: payment.provider, providerPaymentId: payment.paymentId, providerCheckoutUrl: payment.checkoutUrl || null },
      });
      return NextResponse.json({ data: { id: updated.id, status: updated.status, checkoutUrl: updated.providerCheckoutUrl } }, { status: 201 });
    } catch (error) {
      await db.apiAccessPurchase.update({ where: { id: purchase.id }, data: { status: "FAILED" } });
      const message = error instanceof Error ? error.message : "PAYMENT_PROVIDER_ERROR";
      const status = message === "APP_ORIGIN_NOT_CONFIGURED" ? 503 : 502;
      return NextResponse.json({ error: status === 503 ? message : "PAYMENT_PROVIDER_ERROR" }, { status });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "API_ACCESS_CHECKOUT_FAILED";
    const status = message === "UNAUTHORIZED" ? 401 : message === "IDEMPOTENCY_CONFLICT" ? 409 : 500;
    if (status === 500) console.error(JSON.stringify({ event: "api_access_checkout_failed", requestId: randomUUID() }));
    return NextResponse.json({ error: status === 500 ? "API_ACCESS_CHECKOUT_FAILED" : message }, { status });
  }
}