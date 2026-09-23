import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

/*
 * Master Task Plan Section 3, item 3 —
 * "مركز تحكم API للمالك: عرض ونسخ وإدارة المفتاح، ومتابعة الاستخدام".
 */
export async function GET(req: NextRequest) {
  const blocked = await guardMutation(
    req,
    "owner:api-keys:list",
    30,
  );

  if (blocked) {
    return blocked;
  }

  try {
    await requireOwner();

    const keys = await db.apiKey.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        keyPrefix: true,
        label: true,
        status: true,
        requestCount: true,
        lastUsedAt: true,
        createdAt: true,
        revokedAt: true,
        user: {
          select: { id: true, email: true, username: true },
        },
      },
    });

    const totalRevenueCents = await db.apiKeyPurchase.aggregate({
      where: { status: "PAID" },
      _sum: { priceCents: true },
    });

    return NextResponse.json({
      keys,
      totalActiveKeys: keys.filter(
        (k) => k.status === "ACTIVE",
      ).length,
      totalRevenueCents:
        totalRevenueCents._sum.priceCents ?? 0,
    });
  } catch {
    return NextResponse.json(
      { error: "FORBIDDEN" },
      { status: 403 },
    );
  }
}
