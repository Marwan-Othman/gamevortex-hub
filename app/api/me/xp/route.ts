import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { awardActionXp } from "@/lib/gamer";
import { guardMutation, userRouteError } from "@/lib/api";
import { db } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const allowed = new Set(["FAVORITED_GAME", "WISHLISTED_GAME", "REVIEWED_GAME", "ADDED_TO_LIBRARY", "COMPLETED_GAME"]);
type XpAction = "FAVORITED_GAME" | "WISHLISTED_GAME" | "REVIEWED_GAME" | "ADDED_TO_LIBRARY" | "COMPLETED_GAME";

/**
 * XP is never minted from a bare client claim. The caller must name a real
 * published game AND already own the matching record (favorite, wishlist entry,
 * review, library item, or a library item marked BEATEN). awardActionXp is
 * idempotent per (user, action, game), so replays award nothing.
 */
async function hasQualifyingRecord(userId: string, action: XpAction, gameId: string) {
  const where = { userId, gameId };
  switch (action) {
    case "FAVORITED_GAME":
      return Boolean(await db.favoriteGame.findFirst({ where, select: { id: true } }));
    case "WISHLISTED_GAME":
      return Boolean(await db.wishlistGame.findFirst({ where, select: { id: true } }));
    case "REVIEWED_GAME":
      return Boolean(await db.review.findFirst({ where, select: { id: true } }));
    case "ADDED_TO_LIBRARY":
      return Boolean(await db.gameLibraryItem.findFirst({ where, select: { id: true } }));
    case "COMPLETED_GAME":
      return Boolean(await db.gameLibraryItem.findFirst({ where: { ...where, status: "BEATEN" }, select: { id: true } }));
  }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "me:xp", 20);
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => null);
    const action = typeof body?.action === "string" ? body.action : "";
    const gameId = typeof body?.gameId === "string" ? body.gameId.trim() : "";
    if (!allowed.has(action)) return NextResponse.json({ error: "INVALID_XP_ACTION" }, { status: 400 });
    if (!gameId || gameId.length > 100) return NextResponse.json({ error: "GAME_ID_REQUIRED" }, { status: 400 });

    const game = await db.game.findFirst({ where: { id: gameId, published: true }, select: { id: true } });
    if (!game) return NextResponse.json({ error: "GAME_NOT_FOUND" }, { status: 404 });

    if (!(await hasQualifyingRecord(user.id, action as XpAction, game.id))) {
      return NextResponse.json({ error: "XP_REQUIREMENT_NOT_MET" }, { status: 403 });
    }

    const result = await awardActionXp(user.id, action as XpAction, game.id);
    return NextResponse.json({ awarded: Boolean(result), result });
  } catch (error) {
    return userRouteError(error, "XP_FAILED");
  }
}
