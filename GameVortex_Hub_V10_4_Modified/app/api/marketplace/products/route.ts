import { NextRequest, NextResponse } from "next/server";

import {
  ProductKind,
  SourceStatus,
  DeliveryType,
  DigitalKeyStatus,
} from "@prisma/client";

import { db } from "@/lib/prisma";
import { guardRead } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
) {
  const blocked =
    await guardRead(
      request,
      "marketplace:products",
      120,
    );

  if (blocked) return blocked;

  const products =
    await db.gameProduct.findMany({
      where: {
        /*
         * المنتج يجب أن يكون منشورًا
         * من لوحة المالك.
         */
        active: true,

        /*
         * نظام الطلب الحالي يدعم
         * GAME_KEY.
         */
        kind: ProductKind.GAME_KEY,

        /*
         * التسليم الحالي يتم عبر
         * كود رقمي.
         */
        deliveryType:
          DeliveryType.CODE,

        /*
         * المورد يجب أن يكون موثقًا.
         */
        supplierVerified: true,

        /*
         * اللعبة المرتبطة بالمنتج يجب
         * أن تكون منشورة ومصدرها موثقًا.
         */
        game: {
          published: true,

          sourceStatus: {
            in: [
              SourceStatus.VERIFIED,
              SourceStatus.OFFICIAL_SOURCE,
            ],
          },
        },

        /*
         * يجب وجود مخزون أو مفتاح
         * رقمي متاح للتسليم.
         */
        OR: [
          {
            inventory: {
              gt: 0,
            },
          },

          {
            digitalKeys: {
              some: {
                status:
                  DigitalKeyStatus.AVAILABLE,
              },
            },
          },
        ],
      },

      include: {
        game: {
          select: {
            id: true,
            slug: true,
            titleAr: true,
            titleEn: true,
            coverUrl: true,
            ratingAverage: true,
          },
        },

        /*
         * نستخدم هذا فقط لمعرفة أن
         * هناك مفتاحًا متاحًا.
         *
         * لا نرسل الكود نفسه للمستخدم.
         */
        digitalKeys: {
          where: {
            status:
              DigitalKeyStatus.AVAILABLE,
          },

          select: {
            id: true,
          },

          take: 1,
        },
      },

      orderBy: {
        createdAt: "desc",
      },

      take: 100,
    });

  const availableProducts =
    products.filter(
      (product) => {
        const hasInventory =
          typeof product.inventory ===
            "number" &&
          product.inventory > 0;

        const hasAvailableKey =
          product.digitalKeys.length >
          0;

        return (
          hasInventory ||
          hasAvailableKey
        );
      },
    );

  const response =
    availableProducts.map(
      (product) => ({
        id: product.id,

        sku: product.sku,

        title: product.title,

        description:
          product.description,

        priceCents:
          product.priceCents,

        currency:
          product.currency,

        kind:
          product.kind,

        deliveryType:
          product.deliveryType,

        region:
          product.region,

        country:
          product.country,

        provider:
          product.provider,

        game:
          product.game,

        available: true,
      }),
    );

  return NextResponse.json(
    response,
    {
      headers: {
        "Cache-Control":
          "public, s-maxage=60, stale-while-revalidate=120",
      },
    },
  );
}
