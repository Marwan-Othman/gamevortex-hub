import { NextRequest, NextResponse } from "next/server";
import { DeliveryType, DigitalKeyStatus, ProductKind } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";
import { encryptDigitalKey, keyFingerprint } from "@/lib/digital-keys";

const keySchema = z.object({
  codes: z.array(z.string().trim().min(4).max(1000)).min(1).max(500),
});

async function productIdFrom(params: Promise<{ id: string }>) {
  const { id } = await params;
  return z.string().cuid().parse(id);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await guardRead(request, "admin:digital-keys", 60);
  if (blocked) return blocked;

  try {
    await requireOwner();
    const productId = await productIdFrom(params);
    const product = await db.gameProduct.findUnique({
      where: { id: productId },
      select: { id: true, sku: true, title: true, kind: true, deliveryType: true, supplierVerified: true },
    });
    if (!product) return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });

    const inventory = await db.digitalKey.groupBy({
      by: ["status"],
      where: { productId },
      _count: { _all: true },
    });
    const counts = Object.fromEntries(inventory.map((item) => [item.status, item._count._all]));

    return NextResponse.json({
      product,
      counts: {
        available: counts[DigitalKeyStatus.AVAILABLE] ?? 0,
        delivered: counts[DigitalKeyStatus.DELIVERED] ?? 0,
        revoked: counts[DigitalKeyStatus.REVOKED] ?? 0,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "INVALID_PRODUCT_ID" }, { status: 400 });
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await guardMutation(request, "admin:digital-keys", 10);
  if (blocked) return blocked;

  try {
    const owner = await requireOwner();
    const productId = await productIdFrom(params);
    const { codes } = keySchema.parse(await request.json());
    const normalizedCodes = [...new Set(codes.map((code) => code.trim()))];
    const product = await db.gameProduct.findUnique({ where: { id: productId } });

    if (!product) return NextResponse.json({ error: "PRODUCT_NOT_FOUND" }, { status: 404 });
    if (product.kind !== ProductKind.GAME_KEY || product.deliveryType !== DeliveryType.CODE) {
      return NextResponse.json({ error: "PRODUCT_DOES_NOT_USE_DIGITAL_KEYS" }, { status: 409 });
    }
    if (!product.supplierVerified) return NextResponse.json({ error: "SUPPLIER_NOT_VERIFIED" }, { status: 409 });

    const keys = normalizedCodes.map((code) => ({
      productId,
      ciphertext: encryptDigitalKey(code),
      fingerprint: keyFingerprint(code),
    }));

    const result = await db.$transaction(async (transaction) => {
      const inserted = await transaction.digitalKey.createMany({ data: keys, skipDuplicates: true });
      const available = await transaction.digitalKey.count({
        where: { productId, status: DigitalKeyStatus.AVAILABLE },
      });
      await transaction.gameProduct.update({ where: { id: productId }, data: { inventory: available } });
      await transaction.auditLog.create({
        data: {
          actorUserId: owner.id,
          action: "DIGITAL_KEYS_IMPORTED",
          entityType: "GameProduct",
          entityId: productId,
          metadata: { submitted: codes.length, uniqueSubmitted: normalizedCodes.length, inserted: inserted.count, available },
        },
      });
      return { inserted: inserted.count, available };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "INVALID_KEY_IMPORT" }, { status: 400 });
    if (error instanceof Error && error.message === "DIGITAL_KEY_ENCRYPTION_SECRET_NOT_CONFIGURED") {
      return NextResponse.json({ error: "DIGITAL_KEY_ENCRYPTION_SECRET_NOT_CONFIGURED" }, { status: 503 });
    }
    return NextResponse.json({ error: "DIGITAL_KEY_IMPORT_FAILED" }, { status: 400 });
  }
}
