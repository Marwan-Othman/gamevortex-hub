import { NextRequest, NextResponse } from "next/server";
import { ProductKind } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

export const dynamic = "force-dynamic";

const toggleSchema = z.object({
  productIds: z.array(z.string().trim().min(1).max(60)).min(1).max(200),
  active: z.boolean(),
});

/**
 * Owner-only. Shows or hides imported FazerCards products in /gift-cards.
 * Only touches GIFT_CARD products that came from FazerCards.
 * Nothing is purchased and no money moves here.
 */
export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:fazercards-toggle", 60);
  if (blocked) return blocked;

  let owner;
  try {
    owner = await requireOwner();
  } catch {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  try {
    const { productIds, active } = toggleSchema.parse(await request.json());

    const updatedCount = await db.$transaction(async (transaction) => {
      const updated = await transaction.gameProduct.updateMany({
        where: {
          id: { in: productIds },
          kind: ProductKind.GIFT_CARD,
          provider: "fazercards",
        },
        data: { active },
      });

      await transaction.auditLog.create({
        data: {
          actorUserId: owner.id,
          action: active ? "FAZERCARDS_PRODUCTS_ACTIVATED" : "FAZERCARDS_PRODUCTS_DEACTIVATED",
          entityType: "GameProduct",
          entityId: productIds[0],
          metadata: { productIds, count: updated.count },
        },
      });

      return updated.count;
    });

    return NextResponse.json({ ok: true, updated: updatedCount });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: "INVALID_REQUEST" }, { status: 400 });
    }
    console.error("FazerCards toggle failed:", error);
    return NextResponse.json({ ok: false, error: "TOGGLE_FAILED" }, { status: 500 });
  }
}
