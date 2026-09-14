import { NextRequest, NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";
import { logSystemError } from "@/lib/observability";

/**
 * One-time ownership-conflict fix, run from inside the deployed app.
 *
 * This intentionally does NOT use requireOwner() — the whole reason this
 * route exists is that requireOwner() may currently be broken (another
 * account is stuck with the SUPER_ADMIN role). Identity here is instead
 * verified the same way seed-production.mjs does it: by comparing the
 * logged-in user's email against OWNER_EMAIL, which is the actual source
 * of truth for who the owner is, independent of the mutable `role` column.
 *
 * GET  -> dry run, shows what would change, makes no changes.
 * POST -> applies the fix.
 *
 * Delete this file once ownership is confirmed fixed; it should not stay
 * in the codebase long-term.
 */

async function resolveTargetUser() {
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) throw new Error("OWNER_EMAIL_NOT_CONFIGURED");

  const currentUser = await requireUser();
  if (currentUser.email.toLowerCase() !== ownerEmail) {
    throw new Error("NOT_OWNER_EMAIL");
  }
  return { currentUser, ownerEmail };
}

async function buildReport(ownerEmail: string, targetUserId: string) {
  const currentOwners = await db.user.findMany({
    where: { role: Role.SUPER_ADMIN },
    select: { id: true, email: true, username: true },
  });
  return {
    ownerEmail,
    currentOwners: currentOwners.map((u) => ({
      email: u.email,
      username: u.username,
      isTarget: u.id === targetUserId,
    })),
    toDemoteCount: currentOwners.filter((u) => u.id !== targetUserId).length,
  };
}

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:fix-owner", 20);
  if (blocked) return blocked;
  try {
    const { currentUser, ownerEmail } = await resolveTargetUser();
    const report = await buildReport(ownerEmail, currentUser.id);
    return NextResponse.json({ dryRun: true, ...report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "FIX_OWNER_FAILED";
    const status = message === "UNAUTHORIZED" ? 401 : message === "NOT_OWNER_EMAIL" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:fix-owner", 5);
  if (blocked) return blocked;
  try {
    const { currentUser, ownerEmail } = await resolveTargetUser();

    const currentOwners = await db.user.findMany({
      where: { role: Role.SUPER_ADMIN },
      select: { id: true, email: true },
    });
    const toDemote = currentOwners.filter((u) => u.id !== currentUser.id);
    const needsPromotion = currentUser.role !== Role.SUPER_ADMIN;

    await db.$transaction(async (tx) => {
      if (needsPromotion) {
        await tx.user.update({
          where: { id: currentUser.id },
          data: { role: Role.SUPER_ADMIN, sessionVersion: { increment: 1 } },
        });
      }
      for (const u of toDemote) {
        await tx.user.update({
          where: { id: u.id },
          data: { role: Role.USER, sessionVersion: { increment: 1 } },
        });
      }
      await tx.auditLog.create({
        data: {
          actorUserId: currentUser.id,
          action: "OWNER_ROLE_CONFLICT_RESOLVED",
          entityType: "User",
          entityId: currentUser.id,
          metadata: { restoredOwnerEmail: ownerEmail, demotedAccounts: toDemote.map((u) => u.email) },
        },
      });
    });

    return NextResponse.json({
      ok: true,
      restoredOwner: ownerEmail,
      demoted: toDemote.map((u) => u.email),
      note: needsPromotion
        ? "Your account was promoted to SUPER_ADMIN and other conflicting accounts were demoted. Log out and log back in to refresh your session."
        : "Your account was already SUPER_ADMIN; other conflicting accounts were demoted.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "FIX_OWNER_FAILED";
    const status = message === "UNAUTHORIZED" ? 401 : message === "NOT_OWNER_EMAIL" ? 403 : 500;
    if (status === 500) await logSystemError("admin:fix-owner", error);
    return NextResponse.json({ error: message }, { status });
  }
}
