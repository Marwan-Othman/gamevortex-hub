import { NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

/**
 * One-time fix for a real, confirmed production bug: the SystemError
 * migration (prisma/migrations/20260913120000_system_error_log) was
 * committed to the repo, but `prisma migrate deploy` never actually
 * applied it to the live database — every query touching SystemError
 * (used by /admin, /admin/errors, /api/client-error) has been throwing
 * PrismaClientKnownRequestError P2021 ("table does not exist") ever
 * since, intermittently 500-ing those pages.
 *
 * This creates the table directly with idempotent IF NOT EXISTS guards,
 * matching the migration file's schema exactly, so it's safe to call
 * more than once. Identity is checked against OWNER_EMAIL directly
 * (not requireOwner()) so this still works even if role state is ever
 * inconsistent — the same pattern used for the earlier owner-conflict fix.
 *
 * Delete this route once you've confirmed /admin and /admin/errors load
 * without errors — it's a one-time repair tool, not a permanent feature.
 */
export async function POST() {
  try {
    const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
    if (!ownerEmail) throw new Error("OWNER_EMAIL_NOT_CONFIGURED");
    const user = await requireUser();
    if (user.email.toLowerCase() !== ownerEmail) throw new Error("NOT_OWNER_EMAIL");

    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SystemError" (
        "id" TEXT NOT NULL,
        "scope" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "statusCode" INTEGER,
        "userId" TEXT,
        "metadata" JSONB,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("id")
      );
    `);
    await db.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "SystemError_scope_createdAt_idx" ON "SystemError" ("scope", "createdAt");
    `);
    await db.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "SystemError_createdAt_idx" ON "SystemError" ("createdAt");
    `);

    // Verify it actually worked before declaring success.
    const count = await db.systemError.count();

    return NextResponse.json({ ok: true, message: "SystemError table created/verified.", existingRows: count });
  } catch (error) {
    const message = error instanceof Error ? error.message : "REPAIR_FAILED";
    const status = message === "UNAUTHORIZED" ? 401 : message === "NOT_OWNER_EMAIL" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function GET() {
  return NextResponse.json({ note: "POST to this endpoint (while logged in as the owner) to create the missing SystemError table." });
}
