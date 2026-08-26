import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

const paramsSchema = z.object({ id: z.string().cuid() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await guardMutation(request, "draws:enter", 10);
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const { id } = paramsSchema.parse(await params);
    const body = await request.json().catch(() => ({}));
    const tickets = Math.max(1, Math.min(10, Number.isInteger(body?.tickets) ? body.tickets : 1));

    const result = await db.$transaction(async (tx) => {
      const raffle = await tx.raffle.findUnique({ where: { id } });
      if (!raffle) throw new Error("DRAW_NOT_FOUND");
      if (raffle.status !== "OPEN") throw new Error("DRAW_NOT_OPEN");
      if (raffle.drawAt && raffle.drawAt.getTime() <= Date.now()) throw new Error("DRAW_CLOSED");

      if (raffle.maxEntries !== null) {
        const totalTickets = await tx.raffleEntry.aggregate({ where: { raffleId: id }, _sum: { tickets: true } });
        const usedTickets = totalTickets._sum.tickets ?? 0;
        if (usedTickets + tickets > raffle.maxEntries) throw new Error("DRAW_FULL");
      }

      const cost = raffle.ticketCost * tickets;
      if (cost > 0) {
        const debited = await tx.user.updateMany({ where: { id: user.id, points: { gte: cost } }, data: { points: { decrement: cost } } });
        if (debited.count !== 1) throw new Error("INSUFFICIENT_POINTS");
      }

      const entry = await tx.raffleEntry.upsert({
        where: { raffleId_userId: { raffleId: id, userId: user.id } },
        create: { raffleId: id, userId: user.id, tickets },
        update: { tickets: { increment: tickets } },
      });

      await tx.activity.create({ data: { userId: user.id, type: "RAFFLE_ENTERED", message: `دخلت السحب: ${raffle.title}`, metadata: { raffleId: id, tickets } } });
      await tx.notification.create({ data: { userId: user.id, type: "RAFFLE_ENTERED", title: "تم تسجيل تذكرتك", body: `${raffle.title} — ${entry.tickets} تذكرة إجمالًا.`, metadata: { raffleId: id } } });

      return entry;
    });

    return NextResponse.json({ ok: true, entry: result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DRAW_ENTRY_FAILED";
    const status = message === "DRAW_NOT_FOUND" ? 404 : message === "UNAUTHORIZED" ? 401 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
