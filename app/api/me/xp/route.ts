import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { awardActionXp } from "@/lib/gamer";
import { guardMutation } from "@/lib/api";

const allowed = new Set(["FAVORITED_GAME", "WISHLISTED_GAME", "REVIEWED_GAME", "ADDED_TO_LIBRARY", "COMPLETED_GAME"]);

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "me:xp", 20);
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const body = await request.json();
    const action = String(body.action || "");
    const gameId = body.gameId ? String(body.gameId) : undefined;
    if (!allowed.has(action)) return NextResponse.json({ error: "INVALID_XP_ACTION" }, { status: 400 });
    const result = await awardActionXp(user.id, action as any, gameId);
    return NextResponse.json({ awarded: Boolean(result), result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "XP_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
