import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";

export const runtime = "nodejs";

const messageSchema = z.object({
  message: z.string().trim().min(1).max(8000),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const blocked = await guardRead(request, "support:ticket", 60);
  if (blocked) return blocked;

  try {
    const user = await requireUser();
    const { id } = await context.params;

    const ticket = await db.supportTicket.findFirst({
      where: { id, requesterId: user.id },
      select: {
        id: true,
        subject: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        messages: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            authorRole: true,
            body: true,
            createdAt: true,
          },
        },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: "TICKET_NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json(
      { data: ticket },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "SUPPORT_TICKET_FAILED";
    return NextResponse.json(
      { error: message },
      { status: message === "UNAUTHORIZED" ? 401 : 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const blocked = await guardMutation(request, "support:ticket:reply", 10);
  if (blocked) return blocked;

  try {
    const user = await requireUser();
    const { id } = await context.params;
    const parsed = messageSchema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }

    const result = await db.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.findFirst({
        where: { id, requesterId: user.id },
        select: { id: true, status: true, subject: true },
      });

      if (!ticket) throw new Error("TICKET_NOT_FOUND");
      if (ticket.status === "CLOSED") throw new Error("TICKET_CLOSED");

      const message = await tx.supportMessage.create({
        data: {
          ticketId: id,
          authorId: user.id,
          authorRole: user.role,
          body: parsed.data.message,
        },
      });

      await tx.supportTicket.update({
        where: { id },
        data: { status: "OPEN", resolvedAt: null },
      });

      const owner = await tx.user.findFirst({
        where: { role: "SUPER_ADMIN" },
        select: { id: true },
      });

      if (owner && owner.id !== user.id) {
        await tx.notification.create({
          data: {
            userId: owner.id,
            type: "SUPPORT_TICKET_REPLY",
            title: "رد جديد على طلب دعم",
            body: ticket.subject,
            metadata: { ticketId: id, requesterId: user.id },
          },
        });
      }

      return message;
    });

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SUPPORT_REPLY_FAILED";
    const status =
      message === "UNAUTHORIZED"
        ? 401
        : message === "TICKET_NOT_FOUND"
          ? 404
          : message === "TICKET_CLOSED"
            ? 409
            : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
