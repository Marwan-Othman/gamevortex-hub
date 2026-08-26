import { NextRequest, NextResponse } from "next/server";
import { DeliveryType, DigitalKeyStatus, Prisma, ProductKind } from "@prisma/client";
import { db } from "@/lib/prisma";
import { ConfiguredPaymentProvider } from "@/lib/payments";
import { qualifyReferralOnFirstOrder } from "@/lib/referrals";

export const runtime = "nodejs";

type NormalizedEvent = {
  provider: string;
  paymentId: string;
  orderId: string;
  status: "SUCCEEDED" | "FAILED" | "REFUNDED";
  amountCents: number;
  currency?: string;
  raw: unknown;
};

function normalizeStripe(raw: any): NormalizedEvent | null {
  const type = String(raw?.type || "");
  const object = raw?.data?.object;
  if (!object) return null;

  const status = type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded"
    ? "SUCCEEDED"
    : type === "checkout.session.async_payment_failed"
      ? "FAILED"
      : type === "charge.refunded"
        ? "REFUNDED"
        : null;
  if (!status) return null;

  const orderId = String(object?.metadata?.orderId || "");
  if (!orderId) return null;
  const amountCents = Number(object?.amount_total ?? object?.amount ?? object?.amount_refunded ?? -1);

  return {
    provider: "stripe",
    paymentId: String(object.id),
    orderId,
    status,
    amountCents,
    currency: object.currency ? String(object.currency).toUpperCase() : undefined,
    raw,
  };
}


function normalizePayPal(raw: any): NormalizedEvent | null {
  const type = String(raw?.event_type || "");
  const resource = raw?.resource;
  if (!resource) return null;

  const isSuccess = type === "PAYMENT.CAPTURE.COMPLETED";
  const isRefund = type === "PAYMENT.CAPTURE.REFUNDED";
  if (!isSuccess && !isRefund) return null;

  const orderId = String(
    resource?.custom_id ||
    resource?.supplementary_data?.related_ids?.order_id ||
    raw?.resource?.purchase_units?.[0]?.reference_id ||
    ""
  );
  if (!orderId) return null;

  const amount = isRefund
    ? resource?.amount
    : resource?.amount;
  const amountCents = Math.round(Number(amount?.value || 0) * 100);

  return {
    provider: "paypal",
    paymentId: String(resource?.id || raw?.id),
    orderId,
    status: isSuccess ? "SUCCEEDED" : "REFUNDED",
    amountCents,
    currency: amount?.currency_code ? String(amount.currency_code).toUpperCase() : undefined,
    raw,
  };
}

function normalizeGeneric(raw: any): NormalizedEvent | null {
  if (!raw?.provider || !raw?.paymentId || !raw?.orderId) return null;
  if (!['SUCCEEDED', 'FAILED', 'REFUNDED'].includes(raw.status)) return null;

  return {
    provider: String(raw.provider),
    paymentId: String(raw.paymentId),
    orderId: String(raw.orderId),
    status: raw.status,
    amountCents: Number(raw.amountCents),
    currency: raw.currency,
    raw,
  };
}

async function deliverGameKeys(transaction: Prisma.TransactionClient, order: {
  userId: string;
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    product: { kind: ProductKind; deliveryType: DeliveryType; gameId: string };
  }>;
}) {
  for (const item of order.items) {
    if (item.product.kind !== ProductKind.GAME_KEY || item.product.deliveryType !== DeliveryType.CODE) {
      throw new Error("UNSUPPORTED_DELIVERY_TYPE");
    }

    const availableKeys = await transaction.digitalKey.findMany({
      where: { productId: item.productId, status: DigitalKeyStatus.AVAILABLE },
      orderBy: { createdAt: "asc" },
      take: item.quantity,
      select: { id: true },
    });
    if (availableKeys.length !== item.quantity) throw new Error("OUT_OF_STOCK");

    for (const key of availableKeys) {
      const claimed = await transaction.digitalKey.updateMany({
        where: { id: key.id, status: DigitalKeyStatus.AVAILABLE },
        data: {
          status: DigitalKeyStatus.DELIVERED,
          orderItemId: item.id,
          deliveredAt: new Date(),
        },
      });
      if (claimed.count !== 1) throw new Error("DIGITAL_KEY_ALREADY_CLAIMED");
    }

    const remaining = await transaction.digitalKey.count({
      where: { productId: item.productId, status: DigitalKeyStatus.AVAILABLE },
    });
    await transaction.gameProduct.update({ where: { id: item.productId }, data: { inventory: remaining } });
    await transaction.entitlement.upsert({
      where: { userId_gameId: { userId: order.userId, gameId: item.product.gameId } },
      create: { userId: order.userId, gameId: item.product.gameId, orderItemId: item.id },
      update: { revokedAt: null },
    });
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature") || request.headers.get("x-payment-signature") || "";
  const provider = new ConfiguredPaymentProvider();
  const webhookHeaders = Object.fromEntries(Array.from(request.headers.entries()).filter(([key]) => key.startsWith("paypal-")));
  if (!(await provider.verifyWebhook(rawBody, signature, webhookHeaders))) {
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 401 });
  }

  try {
    const parsed = JSON.parse(rawBody);
    const event = provider.name === "stripe" ? normalizeStripe(parsed) : provider.name === "paypal" ? normalizePayPal(parsed) : normalizeGeneric(parsed);
    if (!event || !Number.isInteger(event.amountCents) || event.amountCents < 0) {
      return NextResponse.json({ error: "INVALID_EVENT" }, { status: 400 });
    }

    await db.$transaction(async (transaction) => {
      const order = await transaction.order.findUnique({
        where: { id: event.orderId },
        include: { items: { include: { product: true } } },
      });
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (event.status === "SUCCEEDED" && event.amountCents !== order.totalCents) throw new Error("PAYMENT_AMOUNT_MISMATCH");

      const existing = await transaction.payment.findUnique({
        where: { provider_providerPaymentId: { provider: event.provider, providerPaymentId: event.paymentId } },
      });
      if (existing?.status === "SUCCEEDED" && event.status === "SUCCEEDED") return;

      if (existing) {
        await transaction.payment.update({ where: { id: existing.id }, data: { status: event.status, rawEvent: event.raw as object } });
      } else {
        await transaction.payment.create({
          data: {
            orderId: event.orderId,
            provider: event.provider,
            providerPaymentId: event.paymentId,
            status: event.status,
            amountCents: event.amountCents,
            currency: event.currency || order.currency,
            rawEvent: event.raw as object,
          },
        });
      }

      if (event.status === "SUCCEEDED") {
        await deliverGameKeys(transaction, order);
        await transaction.order.update({
          where: { id: order.id },
          data: { paymentStatus: "SUCCEEDED", status: "COMPLETED", paymentProvider: event.provider },
        });
        await qualifyReferralOnFirstOrder(transaction, order.userId);
      } else if (event.status === "REFUNDED") {
        await transaction.order.update({ where: { id: order.id }, data: { paymentStatus: "REFUNDED", status: "REFUNDED" } });
        await transaction.digitalKey.updateMany({
          where: { orderItemId: { in: order.items.map((item) => item.id) }, status: DigitalKeyStatus.DELIVERED },
          data: { status: DigitalKeyStatus.REVOKED, revokedAt: new Date() },
        });
        await transaction.entitlement.updateMany({
          where: { userId: order.userId, gameId: { in: order.items.map((item) => item.product.gameId) } },
          data: { revokedAt: new Date() },
        });
      } else {
        await transaction.order.update({ where: { id: order.id }, data: { paymentStatus: "FAILED", status: "FAILED" } });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WEBHOOK_PROCESSING_FAILED";
    const status = message === "ORDER_NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
