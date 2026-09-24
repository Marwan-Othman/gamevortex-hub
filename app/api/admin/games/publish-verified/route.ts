import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

function isOfficialStoreUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    return [
      "apps.apple.com",
      "play.google.com",
      "store.steampowered.com",
      "epicgames.com",
      "gog.com",
      "store.playstation.com",
      "xbox.com",
      "nintendo.com",
    ].some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:games:publish", 5);
  if (blocked) return blocked;

  try {
    const owner = await requireOwner();
    const candidates = await db.game.findMany({
      where: { officialUrl: { not: null }, published: false },
      select: { id: true, officialUrl: true },
    });

    const validIds = candidates
      .filter((game) => isOfficialStoreUrl(game.officialUrl))
      .map((game) => game.id);

    const result = validIds.length
      ? await db.game.updateMany({
          where: { id: { in: validIds }, published: false },
          data: { sourceStatus: "VERIFIED", published: true },
        })
      : { count: 0 };

    await db.auditLog.create({
      data: {
        actorUserId: owner.id,
        action: "GAMES_BULK_PUBLISH_VERIFIED",
        entityType: "Game",
        metadata: { candidates: candidates.length, validOfficialStores: validIds.length, updatedCount: result.count },
      },
    });

    return NextResponse.json({
      updated: result.count,
      skippedInvalidUrls: candidates.length - validIds.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { error: "Method Not Allowed. Use POST for publishing games." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
