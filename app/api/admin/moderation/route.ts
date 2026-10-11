import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation, guardRead, ownerRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:moderation", 60);
  if (blocked) return blocked;
  try {
    await requireOwner();
    const reports = await db.contentReport.findMany({
      where: { status: "PENDING" },
      include: {
        reporter: { select: { id: true, username: true } },
        moderator: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    return NextResponse.json(reports, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return ownerRouteError(error, "MODERATION_LOAD_FAILED", 500);
  }
}

const schema = z.object({
  reportId: z.string().trim().min(1).max(100),
  status: z.enum(["APPROVED", "REJECTED", "HIDDEN"]),
  note: z.string().trim().max(1000).optional(),
});

export async function PATCH(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:moderation", 30);
  if (blocked) return blocked;
  try {
    const moderator = await requireOwner();
    const input = schema.parse(await request.json());

    const report = await db.$transaction(async (tx) => {
      // Only a PENDING report can be resolved. The conditional update makes a
      // double click / replay a clean 409 instead of a second ModerationAction.
      const claimed = await tx.contentReport.updateMany({
        where: { id: input.reportId, status: "PENDING" },
        data: { status: input.status, resolutionNote: input.note, moderatorId: moderator.id, resolvedAt: new Date() },
      });
      if (claimed.count !== 1) {
        const existing = await tx.contentReport.findUnique({ where: { id: input.reportId }, select: { id: true } });
        throw new Error(existing ? "REPORT_ALREADY_RESOLVED" : "REPORT_NOT_FOUND");
      }
      const item = await tx.contentReport.findUniqueOrThrow({ where: { id: input.reportId } });
      await tx.moderationAction.create({
        data: { moderatorId: moderator.id, targetType: item.targetType, targetId: item.targetId, action: input.status, reason: input.note },
      });
      return item;
    });

    return NextResponse.json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "REPORT_NOT_FOUND") return NextResponse.json({ error: message }, { status: 404 });
    if (message === "REPORT_ALREADY_RESOLVED") return NextResponse.json({ error: message }, { status: 409 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
    return ownerRouteError(error, "MODERATION_FAILED", 500);
  }
}
