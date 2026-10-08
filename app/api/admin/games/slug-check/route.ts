import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { MAX_GAMES_PER_BATCH, slugify } from "@/lib/game-upload-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Pre-flight for bulk uploads: tells the owner which slugs already exist BEFORE gigabytes of
 * files are uploaded. Final uniqueness is still enforced by POST /api/admin/games/bulk.
 */
export async function POST(request: NextRequest) {
  const guard = await guardMutation(request, "admin-game-slug-check", 60);
  if (guard) return guard;

  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (user.role !== "SUPER_ADMIN") return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "INVALID_JSON" }, { status: 400 });
  }

  const raw =
    typeof body === "object" && body !== null && "slugs" in body && Array.isArray((body as { slugs: unknown }).slugs)
      ? (body as { slugs: unknown[] }).slugs
      : null;
  if (!raw || raw.length < 1 || raw.length > MAX_GAMES_PER_BATCH) {
    return NextResponse.json({ success: false, error: "INVALID_SLUGS" }, { status: 400 });
  }

  const slugs = Array.from(
    new Set(raw.filter((value): value is string => typeof value === "string").map((value) => slugify(value, 100)).filter(Boolean)),
  );
  const existing = await prisma.game.findMany({ where: { slug: { in: slugs } }, select: { slug: true } });
  return NextResponse.json({ success: true, taken: existing.map((row) => row.slug) });
}
