import { NextRequest, NextResponse } from "next/server";
import { DigitalKeyStatus, PaymentStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardRead } from "@/lib/api";
import { decryptDigitalKey } from "@/lib/digital-keys";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await guardRead(request, "orders:keys", 30);
  if (blocked) return blocked;

  try {
    const user = await requireUser();
    const { id: rawId } = await params;
    const id = z.string().cuid().parse(rawId);
    const order = await db.order.findFirst({
      where: { id, userId: user.id, paymentStatus: PaymentStatus.SUCCEEDED },
      include: {
        items: {
          include: {
            product: { select: { title: true, sku: true } },
            digitalKeys: {
              where: { status: DigitalKeyStatus.DELIVERED, revokedAt: null },
              select: { id: true, ciphertext: true, deliveredAt: true },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    });

    if (!order) return NextResponse.json({ error: "ORDER_NOT_FOUND" }, { status: 404 });

    const items = order.items.map((item) => ({
      orderItemId: item.id,
      product: item.product,
      keys: item.digitalKeys.map((key) => ({
        id: key.id,
        code: decryptDigitalKey(key.ciphertext),
        deliveredAt: key.deliveredAt,
      })),
    }));

    return NextResponse.json({ orderId: order.id, items }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "INVALID_ORDER_ID" }, { status: 400 });
    if (error instanceof Error && error.message === "DIGITAL_KEY_ENCRYPTION_SECRET_NOT_CONFIGURED") {
      return NextResponse.json({ error: "DELIVERY_NOT_CONFIGURED" }, { status: 503 });
    }
    return NextResponse.json({ error: "KEY_DELIVERY_FAILED" }, { status: 400 });
  }
}
