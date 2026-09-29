import { NextRequest, NextResponse } from "next/server";
import { DeliveryType, ProductKind } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import {
  getFazerCardsCards,
  getFazerCardsCategories,
} from "@/lib/integrations/fazercards";

export const dynamic = "force-dynamic";

const importSchema = z.object({
  categoryId: z.string().trim().min(1).max(120),
  cardId: z.string().trim().min(1).max(120),
  markupPercent: z.number().min(0).max(500).default(10),
});

function slugPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:fazercards-import", 30);
  if (blocked) return blocked;

  let owner;
  try {
    owner = await requireOwner();
  } catch {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  try {
    const { categoryId, cardId, markupPercent } = importSchema.parse(await request.json());

    const cards = await getFazerCardsCards(categoryId);
    const card = cards.find((item) => item.card_id === cardId);
    if (!card) {
      return NextResponse.json({ ok: false, error: "CARD_NOT_FOUND" }, { status: 404 });
    }

    const costUsd = Number(card.price_usd);
    if (!Number.isFinite(costUsd) || costUsd <= 0) {
      return NextResponse.json({ ok: false, error: "CARD_PRICE_NOT_AVAILABLE" }, { status: 409 });
    }

    const categories = await getFazerCardsCategories();
    const categoryName =
      categories.items?.find((item) => item.category_id === categoryId)?.name ?? categoryId;

    const priceCents = Math.round(costUsd * 100 * (1 + markupPercent / 100));
    const stock = typeof card.stock === "number" && card.stock >= 0 ? Math.floor(card.stock) : null;
    const denominationCents =
      typeof card.denomination === "number" ? Math.round(card.denomination * 100) : null;
    const sku = `FAZER-${categoryId}-${cardId}`;
    const title = `${categoryName} - ${card.name ?? cardId}`.slice(0, 200);
    const gameSlug = `gift-cards-${slugPart(categoryId)}`;

    const result = await db.$transaction(async (transaction) => {
      const game = await transaction.game.upsert({
        where: { slug: gameSlug },
        update: {},
        create: {
          slug: gameSlug,
          titleAr: categoryName,
          titleEn: categoryName,
          published: false,
        },
      });

      const existing = await transaction.gameProduct.findUnique({ where: { sku } });

      const product = existing
        ? await transaction.gameProduct.update({
            where: { sku },
            data: { title, priceCents, inventory: stock, denominationCents },
          })
        : await transaction.gameProduct.create({
            data: {
              gameId: game.id,
              sku,
              title,
              priceCents,
              currency: "USD",
              active: false,
              inventory: stock,
              kind: ProductKind.GIFT_CARD,
              deliveryType: DeliveryType.CODE,
              denominationCents,
              provider: "fazercards",
              fazerCategoryId: categoryId,
              fazerCardId: cardId,
              supplierVerified: true,
            },
          });

      await transaction.auditLog.create({
        data: {
          actorUserId: owner.id,
          action: existing ? "FAZERCARDS_PRODUCT_REFRESHED" : "FAZERCARDS_PRODUCT_IMPORTED",
          entityType: "GameProduct",
          entityId: product.id,
          metadata: { categoryId, cardId, costUsd, markupPercent, priceCents },
        },
      });

      return { product, created: !existing };
    });

    return NextResponse.json(
      {
        ok: true,
        created: result.created,
        productId: result.product.id,
        sku,
        priceCents,
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "INVALID_IMPORT_REQUEST" }, { status: 400 });
    }
    console.error("FazerCards import failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "IMPORT_FAILED",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 },
    );
  }
}
