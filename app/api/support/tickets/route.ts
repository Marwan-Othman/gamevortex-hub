import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  subject: z.string().trim().min(4).max(160),
  message: z.string().trim().min(10).max(8000),
});

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "support:tickets", 30);
  if (blocked) return blocked;

  try {
    const user = await requireUser();
    const tickets = await db.supportTicket.findMany({
      where: { requesterId: user.id },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        subject: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });

    return NextResponse.json(
      { data: tickets },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "SUPPORT_TICKETS_FAILED";
    return NextResponse.json(
      { error: message },
      { status: message === "UNAUTHORIZED" ? 401 : 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "support:tickets:create", 5);
  if (blocked) return blocked;

  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await request.json().catch(() => null));

    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }

    const ticket = await db.$transaction(async (tx) => {
      const created = await tx.supportTicket.create({
        data: {
          requesterId: user.id,
          subject: parsed.data.subject,
          messages: {
            create: {
              authorId: user.id,
              authorRole: user.role,
              body: parsed.data.message,
            },
          },
        },
        select: {
          id: true,
          subject: true,
          status: true,
          createdAt: true,
        },
      });

      const owner = await tx.user.findFirst({
        where: { role: "SUPER_ADMIN" },
        select: { id: true },
      });

      if (owner && owner.id !== user.id) {
        await tx.notification.create({
          data: {
            userId: owner.id,
            type: "SUPPORT_TICKET_CREATED",
            title: "طلب دعم جديد",
            body: parsed.data.subject,
            metadata: { ticketId: created.id, requesterId: user.id },
          },
        });
      }

      return created;
    });

    return NextResponse.json({ data: ticket }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SUPPORT_TICKET_CREATE_FAILED";
    return NextResponse.json(
      { error: message },
      { status: message === "UNAUTHORIZED" ? 401 : 500 },
    );
  }
}
