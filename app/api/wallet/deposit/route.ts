import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation, userRouteError } from "@/lib/api";
import { ConfiguredPaymentProvider } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  amountCents: z.number().int().min(100).max(1_000_000),
  // Wallet.balance is a single USD-denominated balance.
  // Currency is fixed server-side; the browser cannot choose it.
  idempotencyKey: z.string().trim().min(1).max(255).optional(),
});

// The raw row also holds the idempotency key and provider identifiers; the
// browser only needs the public part of a deposit.
function publicDeposit(deposit: {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  createdAt: Date;
}) {
  return {
    id: deposit.id,
    amountCents: deposit.amountCents,
    currency: deposit.currency,
    status: deposit.status,
    createdAt: deposit.createdAt,
  };
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "wallet:deposit", 10);
  if (blocked) return blocked;
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch (error) {
    return userRouteError(error, "AUTH_CHECK_FAILED", "wallet:deposit:auth");
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

  try {
    return await createDeposit(user, parsed.data);
  } catch (error) {
    // The idempotency lookup and the deposit insert run before the provider is called. A database
    // failure there must answer JSON (503 for an outage, 500 otherwise), never an uncaught throw.
    return userRouteError(error, "DEPOSIT_CREATE_FAILED", "wallet:deposit");
  }
}

async function createDeposit(user: { id: string }, input: z.infer<typeof schema>): Promise<NextResponse> {
  const idempotencyKey = input.idempotencyKey || randomUUID();
  const existing = await db.walletDeposit.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.userId !== user.id) return NextResponse.json({ error: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
    // A reused key must describe the same deposit, never a different amount.
    if (existing.amountCents !== input.amountCents) {
      return NextResponse.json({ error: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
    }
    // Only a deposit that is still waiting for its provider payment is resumed
    // below. Anything else is simply reported back.
    if (existing.status !== "PENDING" || existing.providerPaymentId) {
      return NextResponse.json({ ok: true, deposit: publicDeposit(existing), checkoutUrl: null });
    }
  }

  const provider = new ConfiguredPaymentProvider();
  if (!provider.name) return NextResponse.json({ error: "PAYMENT_PROVIDER_NOT_CONFIGURED" }, { status: 503 });

  const appOrigin = process.env.APP_ORIGIN?.trim();
  if (!appOrigin) return NextResponse.json({ error: "APP_ORIGIN_NOT_CONFIGURED" }, { status: 503 });

  const deposit = existing ?? await db.$transaction(async (transaction) => {
    const created = await transaction.walletDeposit.create({
      data: {
        userId: user.id,
        amountCents: input.amountCents,
        currency: "USD",
        provider: provider.name,
        status: "PENDING",
        idempotencyKey,
      },
    });

    const wallet = await transaction.wallet.upsert({
      where: { userId: user.id },
      create: { userId: user.id, balance: 0, pendingBalance: 0 },
      update: {},
    });

    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Wallet" WHERE "id" = ${wallet.id} FOR UPDATE`,
    );

    await transaction.wallet.update({
      where: { id: wallet.id },
      data: {
        pendingBalance: { increment: new Prisma.Decimal(input.amountCents).div(100) },
      },
    });

    return created;
  }).catch(async (error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const concurrent = await db.walletDeposit.findUnique({ where: { idempotencyKey } });
      if (concurrent && concurrent.userId === user.id && concurrent.amountCents === input.amountCents) return concurrent;
    }
    throw error;
  });

  let providerPaymentCreated = false;

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

    providerPaymentCreated = true;

    const updated = await db.walletDeposit.update({
      where: { id: deposit.id },
      data: { providerPaymentId: payment.paymentId },
    });

    return NextResponse.json({ ok: true, deposit: publicDeposit(updated), checkoutUrl: payment.checkoutUrl || null, status: payment.status }, { status: 201 });
  } catch (error) {
    // A provider timeout or transport failure does not prove that no payment was created.
    // Keep the deposit PENDING and its amount reserved; retries use the same deposit ID as
    // the provider idempotency key. Never release funds or mark FAILED without reconciliation.
    return NextResponse.json({
      error: providerPaymentCreated ? "DEPOSIT_PERSISTENCE_PENDING" : "DEPOSIT_PROVIDER_OUTCOME_UNKNOWN",
    }, { status: 502 });
  }
}
