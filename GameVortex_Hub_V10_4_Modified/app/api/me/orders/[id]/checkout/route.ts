import { NextRequest, NextResponse } from "next/server";
import { ProductKind, SourceStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { ConfiguredPaymentProvider } from "@/lib/payments";

function checkoutUrlFrom(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const url = (value as Record<string, unknown>).checkoutUrl;
  return typeof url === "string" && url.startsWith("https://") ? url : undefined;
}

function checkoutReturnUrl() {
  const origin = process.env.APP_ORIGIN;
  if (!origin) return "/orders?checkout=complete";
  try {
    return new URL("/orders?checkout=complete", origin).toString();
  } catch {
    return "/orders?checkout=complete";
  }
}

function isSellableGameKey(item: {
  product: {
    active: boolean;
    supplierVerified: boolean;
    kind: ProductKind;
    deliveryType: string;
    inventory: number | null;
    game: { published: boolean; sourceStatus: SourceStatus };
  };
}) {
  const { product } = item;
  return product.active
    && product.supplierVerified
    && product.kind === ProductKind.GAME_KEY
    && product.deliveryType === "CODE"
    && product.game.published
    && (product.game.sourceStatus === SourceStatus.VERIFIED || product.game.sourceStatus === SourceStatus.OFFICIAL_SOURCE);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await guardMutation(request, "orders:checkout", 10);
  if (blocked) return blocked;

  try {
    const user = await requireUser();
    const { id: rawId } = await params;
    const id = z.string().cuid().parse(rawId);
    const order = await db.order.findFirst({
      where: { id, userId: user.id },
      include: { items: { include: { product: { include: { game: true } } } }, payments: true },
    });

    if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });
    if (order.paymentStatus !== "CREATED" || order.status !== "PENDING") {
      return NextResponse.json({ error: "ORDER_NOT_PAYABLE" }, { status: 409 });
    }
    if (!order.items.length || !order.items.every(isSellableGameKey)) {
      return NextResponse.json({ error: "ORDER_ITEM_NOT_AVAILABLE_FOR_SALE" }, { status: 409 });
    }

    const quantities = new Map<string, number>();
    for (const item of order.items) {
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    }
    for (const [productId, quantity] of quantities) {
      const product = order.items.find((item) => item.productId === productId)?.product;
      if (!product || (product.inventory !== null && product.inventory < quantity)) {
        return NextResponse.json({ error: "ORDER_ITEM_OUT_OF_STOCK" }, { status: 409 });
      }
    }

    const configuredProvider = (process.env.PAYMENT_PROVIDER || "").toLowerCase();
    const existingPayment = order.payments.find((payment) => {
      const url = checkoutUrlFrom(payment.rawEvent);
      return payment.provider === configuredProvider
        && payment.status === "REQUIRES_ACTION"
        && Boolean(url);
    });

    if (existingPayment) {
      return NextResponse.json({
        provider: existingPayment.provider,
        paymentId: existingPayment.providerPaymentId,
        checkoutUrl: checkoutUrlFrom(existingPayment.rawEvent),
        status: existingPayment.status,
        reused: true,
      });
    }

    const provider = new ConfiguredPaymentProvider();
    const payment = await provider.createPayment({
      orderId: order.id,
      amountCents: order.totalCents,
      currency: order.currency,
      returnUrl: checkoutReturnUrl(),
    });

    await db.$transaction(async (transaction) => {
      await transaction.payment.upsert({
        where: {
          provider_providerPaymentId: {
            provider: payment.provider,
            providerPaymentId: payment.paymentId,
          },
        },
        create: {
          orderId: order.id,
          provider: payment.provider,
          providerPaymentId: payment.paymentId,
          status: payment.status,
          amountCents: order.totalCents,
          currency: order.currency,
          rawEvent: payment.checkoutUrl ? { checkoutUrl: payment.checkoutUrl } : undefined,
        },
        update: {
          status: payment.status,
          rawEvent: payment.checkoutUrl ? { checkoutUrl: payment.checkoutUrl } : undefined,
        },
      });
      await transaction.order.update({
        where: { id: order.id },
        data: { paymentProvider: payment.provider, paymentStatus: payment.status },
      });
    });

    return NextResponse.json(payment, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "INVALID_ORDER_ID" }, { status: 400 });
    if (error instanceof Error && error.message === "PAYMENT_PROVIDER_NOT_CONFIGURED") {
      return NextResponse.json({ error: "PAYMENT_PROVIDER_NOT_CONFIGURED" }, { status: 503 });
    }
    return NextResponse.json({ error: "CHECKOUT_FAILED" }, { status: 400 });
  }
}
