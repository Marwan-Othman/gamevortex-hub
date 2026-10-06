import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { ConfiguredPaymentProvider } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  amountCents: z.number().int().min(100).max(1_000_000),
  // Wallet.balance is a single USD-denominated balance.
  // Currency is fixed server-side; the browser cannot choose it.
  idempotencyKey: z.string().trim().min(1).max(255).optional(),
});

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "wallet:deposit", 10);
  if (blocked) return blocked;
  const user = await requireUser();
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

  const idempotencyKey = parsed.data.idempotencyKey || randomUUID();
  const existing = await db.walletDeposit.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.userId !== user.id) return NextResponse.json({ error: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
    return NextResponse.json({ ok: true, deposit: existing, checkoutUrl: null });
  }

  const provider = new ConfiguredPaymentProvider();
  if (!provider.name) return NextResponse.json({ error: "PAYMENT_PROVIDER_NOT_CONFIGURED" }, { status: 503 });

  const appOrigin = process.env.APP_ORIGIN?.trim();
  if (!appOrigin) return NextResponse.json({ error: "APP_ORIGIN_NOT_CONFIGURED" }, { status: 503 });

  const deposit = await db.walletDeposit.create({
    data: {
      userId: user.id,
      amountCents: parsed.data.amountCents,
      currency: "USD",
      provider: provider.name,
      status: "PENDING",
      idempotencyKey,
    },
  });

  try {
    const returnUrl = new URL("/payment/return", appOrigin);
    returnUrl.searchParams.set("target", "wallet");
    returnUrl.searchParams.set("reference", deposit.id);

    const payment = await provider.createPayment({
      orderId: deposit.id,
      amountCents: deposit.amountCents,
      currency: deposit.currency,
      returnUrl: returnUrl.toString(),
      idempotencyKey: `wallet-deposit-payment:${deposit.id}`,
    });

    const updated = await db.walletDeposit.update({
      where: { id: deposit.id },
      data: { providerPaymentId: payment.paymentId },
    });

    return NextResponse.json({ ok: true, deposit: updated, checkoutUrl: payment.checkoutUrl || null, status: payment.status }, { status: 201 });
  } catch (error) {
    await db.walletDeposit.update({ where: { id: deposit.id }, data: { status: "FAILED" } }).catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "DEPOSIT_CREATE_FAILED" }, { status: 502 });
  }
}
