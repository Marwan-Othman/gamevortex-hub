import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { guardMutation } from "@/lib/api";
import { canonicalBlobUrl } from "@/lib/game-upload-shared";
import { findReferencedBlobUrls, safeCleanupBlobs } from "@/lib/game-upload-server";
import { isContentType } from "@/lib/content-admin";
import {
  loadContentForm,
  loadExistingContent,
  parseContentInput,
  requireContentOwner,
  sourceProviderFor,
  sourceStatusFor,
  storedBlobUrls,
} from "@/lib/content-admin-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ type: string; id: string }> };

/** Loads one game/app so the same page can edit it. */
export async function GET(_request: NextRequest, context: Context) {
  const auth = await requireContentOwner();
  if ("error" in auth) return auth.error;

  const { type, id } = await context.params;
  if (!isContentType(type)) return NextResponse.json({ success: false, error: "INVALID_TYPE" }, { status: 400 });

  const data = await loadContentForm(type, id);
  if (!data) return NextResponse.json({ success: false, error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ success: true, data });
}

function sameFile(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return a === b;
  const strip = (value: string) => value.split("?")[0].split("#")[0];
  return strip(a) === strip(b);
}

/** Updates a game/app from the same page. Replaced or removed Blob files are cleaned up afterwards. */
export async function PATCH(request: NextRequest, context: Context) {
  const guard = await guardMutation(request, "admin-content-update", 120);
  if (guard) return guard;

  const auth = await requireContentOwner();
  if ("error" in auth) return auth.error;
  const { owner } = auth;

  const { type, id } = await context.params;
  if (!isContentType(type)) return NextResponse.json({ success: false, error: "INVALID_TYPE" }, { status: 400 });

  let addedUrls: string[] = [];
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: "INVALID_BODY" }, { status: 400 });
    }

    const existing = await loadExistingContent(type, id);
    if (!existing) return NextResponse.json({ success: false, error: "NOT_FOUND" }, { status: 404 });

    const parsed = parseContentInput(
      { ...(body as Record<string, unknown>), type },
      {
        unchangedSourceUrl: existing.downloadSource,
        existingImageUrls: [existing.coverUrl, existing.iconUrl, ...existing.screenshots].filter(
          (value): value is string => Boolean(value),
        ),
      },
    );
    if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    const input = parsed.value;

    const oldUrls = storedBlobUrls({
      downloadSource: existing.downloadSource,
      coverUrl: existing.coverUrl,
      iconUrl: existing.iconUrl,
      screenshots: existing.screenshots,
    });
    const keep = (url: string) => oldUrls.some((old) => sameFile(old, url));

    // Only files that are new on this item need to be checked against other items.
    const incoming = [
      input.source.kind === "upload" ? input.source.url : null,
      input.mainImage,
      ...input.screenshots,
    ].filter((value): value is string => Boolean(value) && !keep(value as string));
    if (incoming.length && (await findReferencedBlobUrls(incoming)).size) {
      return NextResponse.json({ success: false, error: "FILE_ALREADY_USED" }, { status: 409 });
    }
    addedUrls = incoming;

    const sourceChanged = input.source.kind !== "none" && !sameFile(existing.downloadSource, input.source.url);
    const downloadSource = input.source.kind === "none" ? existing.downloadSource : input.source.url;

    // Keep multi-platform items intact unless the owner picked a platform they don't have yet.
    const platformChanged = !existing.platforms.includes(input.platform);
    const nameChanged = input.name !== existing.name;
    const descriptionChanged = input.description !== (existing.description ?? "");

    const common = {
      isMod: input.isMod,
      published: input.published,
      screenshots: input.screenshots,
      coverUrl: input.mainImage,
      ...(sourceChanged
        ? {
            downloadSource,
            sourceStatus: sourceStatusFor(input.source),
            sourceProvider: sourceProviderFor(input.source),
          }
        : {}),
    };

    if (type === "game") {
      await prisma.$transaction(async (tx) => {
        await tx.game.update({
          where: { id },
          data: {
            ...common,
            ...(nameChanged ? { titleAr: input.name, titleEn: input.name } : {}),
            ...(descriptionChanged ? { description: input.description || null } : {}),
            ...(platformChanged ? { platform: input.platform } : {}),
          },
        });
        if (platformChanged) {
          await tx.gamePlatform.deleteMany({ where: { gameId: id } });
          await tx.gamePlatform.create({ data: { gameId: id, platform: input.platform } });
        }
      });
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.app.update({
          where: { id },
          data: {
            ...common,
            iconUrl: input.mainImage,
            ...(nameChanged ? { nameAr: input.name, nameEn: input.name } : {}),
            ...(descriptionChanged
              ? { descriptionAr: input.description || null, descriptionEn: input.description || null }
              : {}),
          },
        });
        if (platformChanged) {
          await tx.appPlatform.deleteMany({ where: { appId: id } });
          await tx.appPlatform.create({ data: { appId: id, platform: input.platform } });
        }
      });
    }

    await prisma.auditLog
      .create({
        data: {
          actorUserId: owner.id,
          action: type === "game" ? "GAME_UPDATED" : "APP_UPDATED",
          entityType: type === "game" ? "Game" : "App",
          entityId: id,
          metadata: { sourceChanged, platformChanged, isMod: input.isMod, published: input.published },
        },
      })
      .catch(() => undefined);

    // Files that are no longer used by this item (replaced APK/images, removed screenshots).
    const nowUrls = new Set(
      [downloadSource, input.mainImage, ...input.screenshots].filter((value): value is string => Boolean(value)),
    );
    const orphaned = oldUrls.filter(
      (old) => canonicalBlobUrl(old, "game") || canonicalBlobUrl(old, "cover")
        ? ![...nowUrls].some((current) => sameFile(current, old))
        : false,
    );
    addedUrls = [];
    if (orphaned.length) {
      await safeCleanupBlobs(orphaned.map((url) => url.split("?")[0]));
    }

    return NextResponse.json({ success: true, data: { id, type } });
  } catch (error) {
    console.error("PATCH /api/admin/content error:", error instanceof Error ? error.message : "UNKNOWN");
    await safeCleanupBlobs(addedUrls);
    return NextResponse.json({ success: false, error: "CONTENT_UPDATE_FAILED" }, { status: 500 });
  }
}
