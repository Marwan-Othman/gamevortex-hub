import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation, publicErrorCode } from "@/lib/api";
import { debitPointsInTransaction } from "@/lib/points";

const paramsSchema = z.object({ id: z.string().cuid() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await guardMutation(request, "draws:enter", 10);
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const { id } = paramsSchema.parse(await params);
    const requestId = request.headers.get("idempotency-key")?.trim() || "";
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(requestId)) {
      return NextResponse.json({ error: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
    }
    const idempotencyKey = `raffle-entry:${user.id}:${requestId}`;
    const body = await request.json().catch(() => ({}));
    const tickets = Math.max(1, Math.min(10, Number.isInteger(body?.tickets) ? body.tickets : 1));

    const result = await db.$transaction(async (tx) => {
      // Serialize entries for this draw: the capacity check below counts tickets
      // and, without the lock, concurrent buyers all see the same free capacity,
      // pay with points and oversell the draw.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Raffle" WHERE "id" = ${id} FOR UPDATE`);

      const previous = await tx.raffleEntryRequest.findUnique({ where: { idempotencyKey } });
      if (previous) {
        if (previous.raffleId !== id || previous.tickets !== tickets) throw new Error("IDEMPOTENCY_KEY_CONFLICT");
        const entry = await tx.raffleEntry.findUnique({ where: { id: previous.raffleEntryId } });
        if (!entry) throw new Error("DRAW_ENTRY_NOT_FOUND");
        return { entry, replayed: true };
      }

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
        await debitPointsInTransaction(tx, {
          userId: user.id,
          amount: cost,
          reason: "RAFFLE_TICKET_PURCHASE",
          sourceId: id,
          idempotencyKey,
          metadata: { tickets, raffleId: id },
        });
      }

      const entry = await tx.raffleEntry.upsert({
        where: { raffleId_userId: { raffleId: id, userId: user.id } },
        create: { raffleId: id, userId: user.id, tickets },
        update: { tickets: { increment: tickets } },
      });

      await tx.raffleEntryRequest.create({
        data: { userId: user.id, raffleId: id, raffleEntryId: entry.id, tickets, pointsCharged: cost, idempotencyKey },
      });

      await tx.activity.create({ data: { userId: user.id, type: "RAFFLE_ENTERED", message: `دخلت السحب: ${raffle.title}`, metadata: { raffleId: id, tickets } } });
      await tx.notification.create({ data: { userId: user.id, type: "RAFFLE_ENTERED", title: "تم تسجيل تذكرتك", body: `${raffle.title} — ${entry.tickets} تذكرة إجمالًا.`, metadata: { raffleId: id } } });

      return { entry, replayed: false };
    });

    return NextResponse.json({ ok: true, entry: result.entry, replayed: result.replayed }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "IDEMPOTENCY_KEY_IN_PROGRESS" }, { status: 409 });
    }
    const message = publicErrorCode(error, "DRAW_ENTRY_FAILED");
    const known = new Set([
      "DRAW_NOT_FOUND", "DRAW_NOT_OPEN", "DRAW_CLOSED", "DRAW_FULL", "DRAW_ENTRY_NOT_FOUND",
      "IDEMPOTENCY_KEY_CONFLICT", "INSUFFICIENT_POINTS", "UNAUTHORIZED",
    ]);
    if (!known.has(message)) {
      return NextResponse.json({ error: "DRAW_ENTRY_FAILED" }, { status: 500 });
    }
    const status = message === "DRAW_NOT_FOUND" ? 404 : message === "UNAUTHORIZED" ? 401 : message === "INSUFFICIENT_POINTS" ? 402 : 409;
    return NextResponse.json({ error: message }, { status });
  }
}
