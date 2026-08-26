import { NextRequest, NextResponse } from "next/server";
import { Prisma, ProductKind, SourceStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";

const createSchema = z.object({
  items: z.array(z.object({
    productId: z.string().cuid(),
    quantity: z.number().int().min(1).max(10),
  })).min(1).max(20),
  idempotencyKey: z.string().min(16).max(100),
});

const sellableProductWhere = {
  active: true,
  supplierVerified: true,
  kind: ProductKind.GAME_KEY,
  deliveryType: "CODE" as const,
  game: {
    published: true,
    sourceStatus: { in: [SourceStatus.VERIFIED, SourceStatus.OFFICIAL_SOURCE] },
  },
};

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "orders:read");
  if (blocked) return blocked;

  try {
    const user = await requireUser();
    const orders = await db.order.findMany({
      where: { userId: user.id },
      include: { items: { include: { product: true } }, payments: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json(orders);
  } catch {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "orders:create", 10);
  if (blocked) return blocked;

  try {
    const user = await requireUser();
    const body = createSchema.parse(await request.json());

    const existing = await db.order.findUnique({ where: { idempotencyKey: body.idempotencyKey } });
    if (existing) {
      if (existing.userId !== user.id) return NextResponse.json({ error: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
      return NextResponse.json(existing);
    }

    const quantities = new Map<string, number>();
    for (const item of body.items) {
      quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    }

    const items = [...quantities.entries()].map(([productId, quantity]) => ({ productId, quantity }));
    if (items.some((item) => item.quantity > 10)) {
      return NextResponse.json({ error: "PRODUCT_QUANTITY_LIMIT_EXCEEDED" }, { status: 400 });
    }

    const products = await db.gameProduct.findMany({
      where: { id: { in: items.map((item) => item.productId) }, ...sellableProductWhere },
      include: { game: true },
    });

    if (products.length !== items.length) {
      return NextResponse.json({ error: "PRODUCT_NOT_AVAILABLE_FOR_SALE" }, { status: 404 });
    }

    const productsById = new Map(products.map((product) => [product.id, product]));
    const currencies = new Set(products.map((product) => product.currency));
    if (currencies.size !== 1) return NextResponse.json({ error: "MIXED_CURRENCY_NOT_SUPPORTED" }, { status: 400 });

    let subtotalCents = 0;
    for (const item of items) {
      const product = productsById.get(item.productId);
      if (!product) return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
      if (product.inventory !== null && product.inventory < item.quantity) {
        return NextResponse.json({ error: `OUT_OF_STOCK:${product.sku}` }, { status: 409 });
      }
      subtotalCents += product.priceCents * item.quantity;
    }

    const currency = products[0]?.currency;
    if (!currency) return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });

    const order = await db.$transaction(async (transaction) => transaction.order.create({
      data: {
        userId: user.id,
        subtotalCents,
        totalCents: subtotalCents,
        currency,
        idempotencyKey: body.idempotencyKey,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPriceCents: productsById.get(item.productId)!.priceCents,
          })),
        },
      },
      include: { items: true },
    }));

    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "INVALID_ORDER" }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "ORDER_ALREADY_EXISTS" }, { status: 409 });
    }
    return NextResponse.json({ error: "ORDER_FAILED" }, { status: 400 });
  }
}
