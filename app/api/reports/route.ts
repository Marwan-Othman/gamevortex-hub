import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation, userRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

const schema = z.object({
  targetType: z.enum(["GAME", "REVIEW", "USER", "ACTIVITY"]),
  targetId: z.string().trim().min(1).max(100),
  reason: z.enum(["SPAM", "ABUSE", "FRAUD", "COPYRIGHT", "NSFW", "MISLEADING", "OTHER"]),
  details: z.string().trim().max(1000).optional(),
});

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "reports", 10);
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "INVALID_REPORT" }, { status: 400 });
    const input = parsed.data;

    // The same user cannot stack reports on one target while one is still open
    // (replays / double clicks return the existing report instead of spamming moderators).
    const open = await db.contentReport.findFirst({
      where: { reporterId: user.id, targetType: input.targetType, targetId: input.targetId, status: "PENDING" },
      select: { id: true, status: true, createdAt: true },
    });
    if (open) return NextResponse.json(open, { status: 200 });

    // Cap the number of simultaneously open reports one account can hold.
    const pendingCount = await db.contentReport.count({ where: { reporterId: user.id, status: "PENDING" } });
    if (pendingCount >= 50) return NextResponse.json({ error: "TOO_MANY_OPEN_REPORTS" }, { status: 429 });

    const report = await db.contentReport.create({
      data: { reporterId: user.id, ...input },
      select: { id: true, status: true, createdAt: true },
    });
    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    return userRouteError(error, "REPORT_FAILED");
  }
}
