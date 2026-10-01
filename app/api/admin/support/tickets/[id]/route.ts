import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";

export const runtime = "nodejs";
const replySchema = z.object({ message: z.string().trim().min(1).max(8000) });
const statusSchema = z.object({ status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_USER", "RESOLVED", "CLOSED"]) });

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = await guardRead(request, "admin:support:ticket", 60);
  if (blocked) return blocked;
  try {
    await requireOwner();
    const { id } = await context.params;
    const ticket = await db.supportTicket.findUnique({
      where: { id },
      select: { id: true, subject: true, status: true, createdAt: true, updatedAt: true, requester: { select: { id: true, username: true, email: true } }, messages: { orderBy: { createdAt: "asc" }, select: { id: true, authorRole: true, body: true, createdAt: true, author: { select: { username: true, email: true } } } } },
    });
    if (!ticket) return NextResponse.json({ error: "TICKET_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ data: ticket }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SUPPORT_ADMIN_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = await guardMutation(request, "admin:support:reply", 30);
  if (blocked) return blocked;
  try {
    const owner = await requireOwner();
    const { id } = await context.params;
    const parsed = replySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    const result = await db.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!ticket) throw new Error("TICKET_NOT_FOUND");
      if (ticket.status === "CLOSED") throw new Error("TICKET_CLOSED");
      const message = await tx.supportMessage.create({ data: { ticketId: id, authorId: owner.id, authorRole: owner.role, body: parsed.data.message } });
      await tx.supportTicket.update({ where: { id }, data: { status: "WAITING_USER", resolvedAt: null } });
      await tx.auditLog.create({ data: { actorUserId: owner.id, action: "SUPPORT_TICKET_REPLIED", entityType: "SupportTicket", entityId: id } });
      return message;
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SUPPORT_REPLY_FAILED";
    const status = message === "UNAUTHORIZED" ? 401 : message === "TICKET_NOT_FOUND" ? 404 : message === "TICKET_CLOSED" ? 409 : 403;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = await guardMutation(request, "admin:support:status", 30);
  if (blocked) return blocked;
  try {
    const owner = await requireOwner();
    const { id } = await context.params;
    const parsed = statusSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    const result = await db.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.update({ where: { id }, data: { status: parsed.data.status, resolvedAt: parsed.data.status === "RESOLVED" || parsed.data.status === "CLOSED" ? new Date() : null } });
      await tx.auditLog.create({ data: { actorUserId: owner.id, action: "SUPPORT_TICKET_STATUS_CHANGED", entityType: "SupportTicket", entityId: id, metadata: { status: parsed.data.status } } });
      return ticket;
    });
    return NextResponse.json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SUPPORT_STATUS_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "P2025" ? 404 : 400 });
  }
}