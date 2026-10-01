import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardRead } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:support:tickets", 30);
  if (blocked) return blocked;
  try {
    await requireOwner();
    const status = request.nextUrl.searchParams.get("status");
    const valid = ["OPEN", "IN_PROGRESS", "WAITING_USER", "RESOLVED", "CLOSED"] as const;
    const tickets = await db.supportTicket.findMany({
      where: status && valid.includes(status as typeof valid[number]) ? { status: status as typeof valid[number] } : {},
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
      select: { id: true, subject: true, status: true, createdAt: true, updatedAt: true, requester: { select: { id: true, email: true, username: true } }, _count: { select: { messages: true } } },
    });
    return NextResponse.json({ data: tickets }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SUPPORT_ADMIN_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
}