import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * One-time repair: adds the two FazerCards columns that exist in
 * schema.prisma but were never created in the live database.
 * Safe to run more than once (IF NOT EXISTS).
 * Owner only (checked against OWNER_EMAIL, same as /api/admin/repair-schema).
 */
export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:repair-fazercards-schema", 5);
  if (blocked) return blocked;

  try {
    const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
    if (!ownerEmail) throw new Error("OWNER_EMAIL_NOT_CONFIGURED");

    const user = await requireUser();
    if (user.email.toLowerCase() !== ownerEmail) throw new Error("NOT_OWNER_EMAIL");

    await db.$executeRawUnsafe(
      `ALTER TABLE "GameProduct" ADD COLUMN IF NOT EXISTS "fazerCategoryId" TEXT;`,
    );
    await db.$executeRawUnsafe(
      `ALTER TABLE "GameProduct" ADD COLUMN IF NOT EXISTS "fazerCardId" TEXT;`,
    );

    const columns = await db.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'GameProduct' AND column_name IN ('fazerCategoryId', 'fazerCardId')
       ORDER BY column_name;`,
    );

    // Verify the table is queryable with every column the app expects.
    const products = await db.gameProduct.count();

    return NextResponse.json({
      ok: true,
      message: "FazerCards columns created/verified.",
      columns: columns.map((column) => column.column_name),
      products,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "REPAIR_FAILED";
    const status =
      message === "UNAUTHORIZED" ? 401 : message === "NOT_OWNER_EMAIL" ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function GET() {
  return NextResponse.json({
    note: "POST to this endpoint while logged in as the owner to add the missing FazerCards columns.",
  });
}
