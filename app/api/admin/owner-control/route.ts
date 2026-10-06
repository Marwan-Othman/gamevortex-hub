import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const roleSchema = z.object({ role: z.enum(["SUPER_ADMIN", "STAFF", "USER"]) });

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:owner-control", 60);
  if (blocked) return blocked;
  try {
    const owner = await requireOwner();
    const [users, games, products, orders, payments, withdrawals, vipSubscriptions, errors, reports] = await Promise.all([
      db.user.count(), db.game.count(), db.gameProduct.count(), db.order.count(), db.payment.count(),
      db.withdrawalRequest.count({ where: { status: { in: ["REQUESTED", "PENDING", "PROCESSING"] } } }),
      db.vipSubscription.count({ where: { status: "ACTIVE" } }),
      db.systemError.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
      db.contentReport.count({ where: { status: "PENDING" } }),
    ]);
    return NextResponse.json({ ok: true, owner: { id: owner.id, username: owner.username, email: owner.email, role: owner.role }, stats: { users, games, products, orders, payments, pendingWithdrawals: withdrawals, activeVip: vipSubscriptions, errors24h: errors, pendingReports: reports } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OWNER_CONTROL_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
}

export async function PATCH(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:owner-control", 30);
  if (blocked) return blocked;
  try {
    const owner = await requireOwner();
    const body = await request.json();
    const userId = z.string().cuid().parse(body.userId);
    const { role } = roleSchema.parse(body);
    if (userId === owner.id && role !== Role.SUPER_ADMIN) {
      return NextResponse.json({ error: "OWNER_ROLE_CANNOT_BE_REMOVED" }, { status: 409 });
    }

    const target = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, username: true, email: true },
    });
    if (!target) {
      return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    }

    // There is exactly one owner. A SUPER_ADMIN role may only belong to the
    // configured owner account. The API is the authoritative security boundary;
    // the admin UI must never be trusted to enforce this rule by itself.
    const configuredOwnerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
    if (role === Role.SUPER_ADMIN) {
      if (!configuredOwnerEmail) {
        return NextResponse.json({ error: "OWNER_EMAIL_NOT_CONFIGURED" }, { status: 500 });
      }

      if (target.email.trim().toLowerCase() !== configuredOwnerEmail) {
        return NextResponse.json({ error: "ONLY_CONFIGURED_OWNER_CAN_BE_SUPER_ADMIN" }, { status: 409 });
      }

      const otherOwner = await db.user.findFirst({
        where: {
          role: Role.SUPER_ADMIN,
          id: { not: target.id },
        },
        select: { id: true },
      });

      if (otherOwner) {
        return NextResponse.json(
          { error: "SUPER_ADMIN_ALREADY_EXISTS" },
          { status: 409 },
        );
      }
    }

    const updated = await db.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data: { role }, select: { id: true, role: true, username: true, email: true } });
      await tx.auditLog.create({ data: { actorUserId: owner.id, action: "OWNER_ROLE_CHANGED", entityType: "User", entityId: user.id, metadata: { from: target.role, to: role, username: target.username, email: target.email } } });
      return user;
    });
    return NextResponse.json({ ok: true, user: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OWNER_CONTROL_FAILED";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : message === "USER_NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
