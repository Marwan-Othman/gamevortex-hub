import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardRead } from "@/lib/api";
import { getFazerCardsCards } from "@/lib/integrations/fazercards";
import { getAllFazerCardsCategories } from "@/lib/integrations/fazercards-categories";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Owner-only. Reads the FazerCards catalog live.
 *   GET /api/admin/fazercards/catalog                   -> ALL categories (paged automatically)
 *   GET /api/admin/fazercards/catalog?categoryId=xxx    -> cards of a category
 * Read-only: nothing is purchased and nothing is written.
 */
export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:fazercards-catalog", 30);
  if (blocked) return blocked;

  try {
    await requireOwner();
  } catch {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  if (!process.env.FAZER_API_KEY?.trim()) {
    return NextResponse.json(
      { ok: false, error: "FAZER_API_KEY_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  try {
    const categoryId = request.nextUrl.searchParams.get("categoryId")?.trim();

    if (!categoryId) {
      const result = await getAllFazerCardsCategories();
      return NextResponse.json({
        ok: true,
        categories: result.items,
        paging: { pages: result.pages, strategy: result.strategy, meta: result.meta },
      });
    }

    const cards = await getFazerCardsCards(categoryId);

    const skus = cards.map((card) => `FAZER-${categoryId}-${card.card_id}`);
    const existing = await db.gameProduct.findMany({
      where: { sku: { in: skus } },
      select: { fazerCardId: true, active: true, priceCents: true },
    });
    const imported: Record<string, { active: boolean; priceCents: number }> = {};
    for (const item of existing) {
      if (item.fazerCardId) {
        imported[item.fazerCardId] = { active: item.active, priceCents: item.priceCents };
      }
    }

    return NextResponse.json({
      ok: true,
      cards: cards.map((card) => ({
        card_id: card.card_id,
        name: card.name ?? card.card_id,
        denomination: card.denomination ?? null,
        denomination_currency: card.denomination_currency ?? null,
        price_usd: card.price_usd ?? null,
        stock: card.stock ?? null,
      })),
      imported,
    });
  } catch (error) {
    console.error("FazerCards catalog failed:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "FAZERCARDS_REQUEST_FAILED",
        detail: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 502 },
    );
  }
}
