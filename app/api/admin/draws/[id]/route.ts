import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

const paramsSchema = z.object({ id: z.string().cuid() });

const updateSchema = z.object({
  action: z.literal("UPDATE"),
  title: z.string().trim().min(2).max(140).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  prize: z.string().trim().min(1).max(200).optional(),
  ticketCost: z.number().int().min(0).max(1_000_000).optional(),
  maxEntries: z.number().int().min(1).max(1_000_000).optional().nullable(),
  drawAt: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "INVALID_DATE").optional().nullable(),
  status: z.enum(["DRAFT", "OPEN", "CANCELLED"]).optional(),
});

const drawSchema = z.object({ action: z.literal("DRAW") });

/** Weighted random pick: each raffle ticket is one slot in the pool. */
function pickWeightedWinner(entries: Array<{ userId: string; tickets: number }>) {
  const totalTickets = entries.reduce((sum, entry) => sum + entry.tickets, 0);
  if (totalTickets <= 0) return null;
  let ticket = randomInt(0, totalTickets);
  for (const entry of entries) {
    if (ticket < entry.tickets) return entry.userId;
    ticket -= entry.tickets;
  }
  return entries[entries.length - 1]?.userId ?? null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await guardMutation(request, "admin:draws", 20);
  if (blocked) return blocked;
  try {
    const owner = await requireOwner();
    const { id } = paramsSchema.parse(await params);
    const body = await request.json();

    if (body?.action === "DRAW") {
      drawSchema.parse(body);
      const result = await db.$transaction(async (tx) => {
        const raffle = await tx.raffle.findUnique({ where: { id }, include: { entries: true } });
        if (!raffle) throw new Error("DRAW_NOT_FOUND");
        if (raffle.status === "DRAWN") throw new Error("DRAW_ALREADY_DRAWN");
        if (raffle.status === "CANCELLED") throw new Error("DRAW_CANCELLED");
        if (!raffle.entries.length) throw new Error("DRAW_HAS_NO_ENTRIES");

        const winnerId = pickWeightedWinner(raffle.entries.map((entry) => ({ userId: entry.userId, tickets: entry.tickets })));
        if (!winnerId) throw new Error("DRAW_HAS_NO_ENTRIES");

        const updated = await tx.raffle.update({ where: { id }, data: { status: "DRAWN", winnerId } });
        await tx.activity.create({ data: { userId: winnerId, type: "RAFFLE_WON", message: `فزت بسحب: ${raffle.title}`, metadata: { raffleId: id, prize: raffle.prize } } });
        await tx.notification.create({ data: { userId: winnerId, type: "RAFFLE_WON", title: "🎉 لقد فزت!", body: `فزت بجائزة "${raffle.prize}" في سحب ${raffle.title}.`, metadata: { raffleId: id } } });
        await tx.auditLog.create({ data: { actorUserId: owner.id, action: "RAFFLE_DRAWN", entityType: "Raffle", entityId: id, metadata: { winnerId } } });
        return updated;
      });
      return NextResponse.json(result);
    }

    const parsed = updateSchema.parse({ action: "UPDATE", ...body });
    const raffle = await db.raffle.update({
      where: { id },
      data: {
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description || null } : {}),
        ...(parsed.prize !== undefined ? { prize: parsed.prize } : {}),
        ...(parsed.ticketCost !== undefined ? { ticketCost: parsed.ticketCost } : {}),
        ...(parsed.maxEntries !== undefined ? { maxEntries: parsed.maxEntries } : {}),
        ...(parsed.drawAt !== undefined ? { drawAt: parsed.drawAt ? new Date(parsed.drawAt) : null } : {}),
        ...(parsed.status !== undefined ? { status: parsed.status } : {}),
      },
    });
    await db.auditLog.create({ data: { actorUserId: owner.id, action: "RAFFLE_UPDATED", entityType: "Raffle", entityId: id, metadata: { status: raffle.status } } });
    return NextResponse.json(raffle);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "INVALID_DRAW_INPUT" }, { status: 400 });
    const message = error instanceof Error ? error.message : "DRAW_UPDATE_FAILED";
    const status = message === "DRAW_NOT_FOUND" ? 404 : message === "FORBIDDEN" ? 403 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
