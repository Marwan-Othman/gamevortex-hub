import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";

const createSchema = z.object({
  title: z.string().trim().min(2).max(140),
  description: z.string().trim().max(2000).optional().nullable(),
  prize: z.string().trim().min(1).max(200),
  ticketCost: z.number().int().min(0).max(1_000_000).default(0),
  maxEntries: z.number().int().min(1).max(1_000_000).optional().nullable(),
  drawAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "INVALID_DATE").optional().nullable(),
  status: z.enum(["DRAFT", "OPEN"]).default("DRAFT"),
});

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:draws", 60);
  if (blocked) return blocked;
  try {
    await requireOwner();
    const raffles = await db.raffle.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { _count: { select: { entries: true } } },
    });
    return NextResponse.json(raffles);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "FORBIDDEN" }, { status: 403 });
  }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:draws", 20);
  if (blocked) return blocked;
  try {
    const owner = await requireOwner();
    const body = createSchema.parse(await request.json());
    const raffle = await db.raffle.create({
      data: {
        title: body.title,
        description: body.description || null,
        prize: body.prize,
        ticketCost: body.ticketCost,
        maxEntries: body.maxEntries ?? null,
        drawAt: body.drawAt ? new Date(body.drawAt) : null,
        status: body.status,
      },
    });
    await db.auditLog.create({ data: { actorUserId: owner.id, action: "RAFFLE_CREATED", entityType: "Raffle", entityId: raffle.id, metadata: { title: raffle.title } } });
    return NextResponse.json(raffle, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "INVALID_DRAW_INPUT" }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "DRAW_CREATE_FAILED" }, { status: 400 });
  }
}
