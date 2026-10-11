import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { guardMutation, guardRead, publicErrorCode, internalError } from "@/lib/api";
import { canonicalBlobUrl } from "@/lib/game-upload-shared";
import { canonicalAnyBlobUrl, findReferencedBlobUrls, resolveUploadCategoryIds, safeCleanupBlobs, verifyUploadedFiles } from "@/lib/game-upload-server";
import { isContentType } from "@/lib/content-admin";
import {
  loadContentForm,
  loadExistingContent,
  parseContentInput,
  requireContentOwner,
  sourceProviderFor,
  sourceStatusFor,
  storedBlobUrls,
  uploadedFileChecks,
} from "@/lib/content-admin-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ type: string; id: string }> };

/** Loads one game/app so the same page can edit it. */
export async function GET(request: NextRequest, context: Context) {
  const limited = await guardRead(request, "admin-content-read", 120);
  if (limited) return limited;

  const auth = await requireContentOwner();
  if ("error" in auth) return auth.error;

  const { type, id } = await context.params;
  if (!isContentType(type)) return NextResponse.json({ success: false, error: "INVALID_TYPE" }, { status: 400 });

  try {
    const data = await loadContentForm(type, id);
    if (!data) return NextResponse.json({ success: false, error: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return internalError("admin:content:read", error, "CONTENT_LOAD_FAILED");
  }
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

    // Only the files added by this save are verified (existing ones were checked when they were uploaded).
    const fileProblem = await verifyUploadedFiles(uploadedFileChecks(input, (url) => incoming.includes(url)));
    if (fileProblem) {
      await safeCleanupBlobs(addedUrls);
      addedUrls = [];
      return NextResponse.json({ success: false, error: fileProblem }, { status: 400 });
    }

    // null = field not sent, keep the stored categories; an array (even empty) replaces them.
    let categoryIds: string[] | null = null;
    if (input.categories) {
      categoryIds = await resolveUploadCategoryIds(input.categories);
      if (categoryIds.length !== input.categories.length) {
        return NextResponse.json({ success: false, error: "INVALID_CATEGORY" }, { status: 400 });
      }
    }

    const sourceChanged = input.source.kind !== "none" && !sameFile(existing.downloadSource, input.source.url);
    const downloadSource = input.source.kind === "none" ? existing.downloadSource : input.source.url;

    // Keep multi-platform items intact unless the owner picked a platform they don't have yet.
    const platformChanged = !existing.platforms.includes(input.platform);
    const nameChanged = input.name !== existing.name;
    const descriptionChanged = input.description !== (existing.description ?? "");

    // Apps keep a separate icon and cover when imported: they only change when the owner changed the image.
    const imageUnchanged = (current: string | null) => sameFile(current, input.mainImage);
    const keepAppImages =
      type === "app" && input.mainImage !== null && (imageUnchanged(existing.coverUrl) || imageUnchanged(existing.iconUrl));
    const finalCover = keepAppImages ? existing.coverUrl : input.mainImage;
    const finalIcon = keepAppImages ? existing.iconUrl : input.mainImage;

    const common = {
      isMod: input.isMod,
      ...(input.version !== undefined ? { version: input.version } : {}),
      published: input.published,
      screenshots: input.screenshots,
      coverUrl: type === "app" ? finalCover : input.mainImage,
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
        if (categoryIds) {
          await tx.gameCategory.deleteMany({ where: { gameId: id } });
          if (categoryIds.length) {
            await tx.gameCategory.createMany({ data: categoryIds.map((categoryId) => ({ gameId: id, categoryId })), skipDuplicates: true });
          }
        }
      });
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.app.update({
          where: { id },
          data: {
            ...common,
            iconUrl: finalIcon,
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
        if (categoryIds) {
          await tx.appCategory.deleteMany({ where: { appId: id } });
          if (categoryIds.length) {
            await tx.appCategory.createMany({ data: categoryIds.map((categoryId) => ({ appId: id, categoryId })), skipDuplicates: true });
          }
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
      [downloadSource, finalCover, finalIcon, ...input.screenshots].filter((value): value is string => Boolean(value)),
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
    console.error("PATCH /api/admin/content error:", publicErrorCode(error, "UNKNOWN"));
    await safeCleanupBlobs(addedUrls);
    return NextResponse.json({ success: false, error: "CONTENT_UPDATE_FAILED" }, { status: 500 });
  }
}

/**
 * Deletes a game/app (owner only). Blocked with 409 when real users already own it or it was
 * ordered, because that history must never disappear: unpublish it instead.
 * Uploaded Blob files that no other item references are removed afterwards.
 */
export async function DELETE(request: NextRequest, context: Context) {
  const guard = await guardMutation(request, "admin-content-delete", 30);
  if (guard) return guard;

  const auth = await requireContentOwner();
  if ("error" in auth) return auth.error;
  const { owner } = auth;

  const { type, id } = await context.params;
  if (!isContentType(type)) return NextResponse.json({ success: false, error: "INVALID_TYPE" }, { status: 400 });

  try {
    const existing = await loadExistingContent(type, id);
    if (!existing) return NextResponse.json({ success: false, error: "NOT_FOUND" }, { status: 404 });

    if (type === "game") {
      const [entitlements, orderedItems] = await Promise.all([
        prisma.entitlement.count({ where: { gameId: id } }),
        prisma.orderItem.count({ where: { product: { gameId: id } } }),
      ]);
      if (entitlements > 0 || orderedItems > 0) {
        return NextResponse.json({ success: false, error: "CONTENT_HAS_PURCHASES" }, { status: 409 });
      }
      await prisma.game.delete({ where: { id } });
    } else {
      await prisma.app.delete({ where: { id } });
    }

    await prisma.auditLog
      .create({
        data: {
          actorUserId: owner.id,
          action: type === "game" ? "GAME_DELETED" : "APP_DELETED",
          entityType: type === "game" ? "Game" : "App",
          entityId: id,
          metadata: { name: existing.name.slice(0, 160) },
        },
      })
      .catch(() => undefined);

    // Only our own uploads are cleaned; files another item still references are protected inside.
    const ours = storedBlobUrls(existing)
      .map((url) => canonicalAnyBlobUrl(url))
      .filter((url): url is string => Boolean(url));
    if (ours.length) await safeCleanupBlobs(ours);

    return NextResponse.json({ success: true, data: { id, type } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2003" || error.code === "P2014")) {
      return NextResponse.json({ success: false, error: "CONTENT_HAS_PURCHASES" }, { status: 409 });
    }
    console.error("DELETE /api/admin/content error:", publicErrorCode(error, "UNKNOWN"));
    return NextResponse.json({ success: false, error: "CONTENT_DELETE_FAILED" }, { status: 500 });
  }
}
