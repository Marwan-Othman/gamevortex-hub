import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { guardMutation, publicErrorCode } from "@/lib/api";
import { canonicalAnyBlobUrl, safeCleanupBlobs } from "@/lib/game-upload-server";
import { loadExistingContent, requireContentOwner, storedBlobUrls } from "@/lib/content-admin-server";
import { isContentType } from "@/lib/content-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Item = { id: string; type: "game" | "app" };
type Action = "pin" | "unpin" | "delete";

export async function POST(request: NextRequest) {
  const guard = await guardMutation(request, "admin-content-bulk", 30);
  if (guard) return guard;

  const auth = await requireContentOwner();
  if ("error" in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "INVALID_BODY" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ success: false, error: "INVALID_BODY" }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  const action = input.action;
  const rawItems = input.items;
  if (action !== "pin" && action !== "unpin" && action !== "delete") {
    return NextResponse.json({ success: false, error: "INVALID_ACTION" }, { status: 400 });
  }
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 60) {
    return NextResponse.json({ success: false, error: "INVALID_ITEMS" }, { status: 400 });
  }

  const items: Item[] = [];
  const seen = new Set<string>();
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return NextResponse.json({ success: false, error: "INVALID_ITEMS" }, { status: 400 });
    }
    const value = raw as Record<string, unknown>;
    if (typeof value.id !== "string" || !value.id || !isContentType(value.type)) {
      return NextResponse.json({ success: false, error: "INVALID_ITEMS" }, { status: 400 });
    }
    const key = `${value.type}:${value.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      items.push({ id: value.id, type: value.type });
    }
  }

  const failed: { id: string; type: string; error: string }[] = [];
  let completed = 0;
  const cleanup: string[] = [];

  for (const item of items) {
    try {
      if (action === "pin" || action === "unpin") {
        const featured = action === "pin";
        const result = item.type === "game"
          ? await prisma.game.updateMany({ where: { id: item.id }, data: { featured } })
          : await prisma.app.updateMany({ where: { id: item.id }, data: { featured } });
        if (result.count === 0) {
          failed.push({ ...item, error: "NOT_FOUND" });
          continue;
        }
        await prisma.auditLog.create({
          data: {
            actorUserId: auth.owner.id,
            action: item.type === "game" ? (featured ? "GAME_FEATURED" : "GAME_UNFEATURED") : (featured ? "APP_FEATURED" : "APP_UNFEATURED"),
            entityType: item.type === "game" ? "Game" : "App",
            entityId: item.id,
            metadata: { featured, source: "admin-content-bulk" },
          },
        }).catch(() => undefined);
        completed++;
        continue;
      }

      const existing = await loadExistingContent(item.type, item.id);
      if (!existing) {
        failed.push({ ...item, error: "NOT_FOUND" });
        continue;
      }
      if (item.type === "game") {
        const [entitlements, orderedItems] = await Promise.all([
          prisma.entitlement.count({ where: { gameId: item.id } }),
          prisma.orderItem.count({ where: { product: { gameId: item.id } } }),
        ]);
        if (entitlements > 0 || orderedItems > 0) {
          failed.push({ ...item, error: "CONTENT_HAS_PURCHASES" });
          continue;
        }
        await prisma.game.delete({ where: { id: item.id } });
      } else {
        await prisma.app.delete({ where: { id: item.id } });
      }
      await prisma.auditLog.create({
        data: {
          actorUserId: auth.owner.id,
          action: item.type === "game" ? "GAME_DELETED" : "APP_DELETED",
          entityType: item.type === "game" ? "Game" : "App",
          entityId: item.id,
          metadata: { name: existing.name.slice(0, 160), source: "admin-content-bulk" },
        },
      }).catch(() => undefined);
      cleanup.push(...storedBlobUrls(existing).map((url) => canonicalAnyBlobUrl(url)).filter((url): url is string => Boolean(url)));
      completed++;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2003" || error.code === "P2014")) {
        failed.push({ ...item, error: "CONTENT_HAS_PURCHASES" });
      } else {
        console.error("POST /api/admin/content/bulk item error:", publicErrorCode(error, "UNKNOWN"));
        failed.push({ ...item, error: "CONTENT_BULK_FAILED" });
      }
    }
  }

  if (cleanup.length) await safeCleanupBlobs(cleanup);
  return NextResponse.json({ success: true, completed, failed, total: items.length });
}
