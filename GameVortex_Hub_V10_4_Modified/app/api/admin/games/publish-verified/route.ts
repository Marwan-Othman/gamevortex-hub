import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

export async function GET(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:games:publish", 5);
  if (blocked) return blocked;

  try {
    const owner = await requireOwner();

    const result = await db.game.updateMany({
      where: {
        officialUrl: { not: null },
        published: false,
      },
      data: {
        sourceStatus: "VERIFIED",
        published: true,
      },
    });

    await db.auditLog.create({
      data: {
        actorUserId: owner.id,
        action: "GAMES_BULK_PUBLISH_VERIFIED",
        entityType: "Game",
        metadata: { updatedCount: result.count },
      },
    });

    return NextResponse.json({
      updated: result.count,
      note: "تم نشر كل الألعاب التي تحتوي على رابط متجر رسمي",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
