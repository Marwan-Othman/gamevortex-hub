import { NextRequest, NextResponse } from "next/server";
import { ProductKind, SourceStatus } from "@prisma/client";
import { db } from "@/lib/prisma";
import { guardRead } from "@/lib/api";

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "marketplace:products", 120);
  if (blocked) return blocked;

  const products = await db.gameProduct.findMany({
    where: {
      active: true,
      supplierVerified: true,
      kind: ProductKind.GAME_KEY,
      deliveryType: "CODE",
      game: {
        published: true,
        sourceStatus: { in: [SourceStatus.VERIFIED, SourceStatus.OFFICIAL_SOURCE] },
      },
    },
    include: {
      game: {
        select: {
          slug: true,
          titleAr: true,
          titleEn: true,
          coverUrl: true,
          ratingAverage: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(products);
}
