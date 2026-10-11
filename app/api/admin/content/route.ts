import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { guardMutation, publicErrorCode } from "@/lib/api";
import { findReferencedBlobUrls, resolveUploadCategoryIds, safeCleanupBlobs, verifyUploadedFiles } from "@/lib/game-upload-server";
import {
  parseContentInput,
  requireContentOwner,
  sourceProviderFor,
  sourceStatusFor,
  uniqueSlug,
  uploadedFileChecks,
} from "@/lib/content-admin-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Creates a game or an app from the single owner content page. */
export async function POST(request: NextRequest) {
  const guard = await guardMutation(request, "admin-content-create", 60);
  if (guard) return guard;

  const auth = await requireContentOwner();
  if ("error" in auth) return auth.error;
  const { owner } = auth;

  let newUrls: string[] = [];
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: "INVALID_BODY" }, { status: 400 });
    }

    const parsed = parseContentInput(body);
    if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    const input = parsed.value;

    if (input.source.kind === "none") {
      return NextResponse.json({ success: false, error: "SOURCE_REQUIRED" }, { status: 400 });
    }

    const uploaded = [
      input.source.kind === "upload" ? input.source.url : null,
      input.mainImage,
      ...input.screenshots,
    ].filter((value): value is string => Boolean(value));

    // Never re-use (or later delete) a file that another item already references.
    if ((await findReferencedBlobUrls(uploaded)).size) {
      return NextResponse.json({ success: false, error: "FILE_ALREADY_USED" }, { status: 409 });
    }
    newUrls = uploaded;

    // The browser uploads straight to Blob: confirm the files exist, are not empty and are really an APK / images.
    const fileProblem = await verifyUploadedFiles(uploadedFileChecks(input));
    if (fileProblem) {
      await safeCleanupBlobs(newUrls);
      newUrls = [];
      return NextResponse.json({ success: false, error: fileProblem }, { status: 400 });
    }

    // Categories must be real, active categories: unknown values are rejected, never created here.
    const categoryIds = input.categories?.length ? await resolveUploadCategoryIds(input.categories) : [];
    if (input.categories && categoryIds.length !== input.categories.length) {
      return NextResponse.json({ success: false, error: "INVALID_CATEGORY" }, { status: 400 });
    }

    const slug = await uniqueSlug(input.type, input.name);
    const downloadSource = input.source.url;
    const description = input.description || null;

    const created =
      input.type === "game"
        ? await prisma.game.create({
            data: {
              slug,
              titleAr: input.name,
              titleEn: input.name,
              description,
              platform: input.platform,
              coverUrl: input.mainImage,
              screenshots: input.screenshots,
              downloadSource,
              isMod: input.isMod,
              version: input.version ?? null,
              sourceStatus: sourceStatusFor(input.source),
              sourceProvider: sourceProviderFor(input.source),
              published: input.published,
              gamePlatforms: { create: [{ platform: input.platform }] },
              gameCategories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
            },
            select: { id: true, slug: true },
          })
        : await prisma.app.create({
            data: {
              slug,
              nameAr: input.name,
              nameEn: input.name,
              descriptionAr: description,
              descriptionEn: description,
              coverUrl: input.mainImage,
              iconUrl: input.mainImage,
              screenshots: input.screenshots,
              downloadSource,
              isMod: input.isMod,
              version: input.version ?? null,
              sourceStatus: sourceStatusFor(input.source),
              sourceProvider: sourceProviderFor(input.source),
              published: input.published,
              appPlatforms: { create: [{ platform: input.platform }] },
              appCategories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
            },
            select: { id: true, slug: true },
          });

    await prisma.auditLog
      .create({
        data: {
          actorUserId: owner.id,
          action: input.type === "game" ? "GAME_CREATED" : "APP_CREATED",
          entityType: input.type === "game" ? "Game" : "App",
          entityId: created.id,
          metadata: {
            slug: created.slug,
            platform: input.platform,
            isMod: input.isMod,
            sourceKind: input.source.kind,
            version: input.version ?? null,
            screenshots: input.screenshots.length,
            categories: categoryIds.length,
          },
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ success: true, data: { ...created, type: input.type } }, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/content error:", publicErrorCode(error, "UNKNOWN"));
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ success: false, error: "SLUG_ALREADY_EXISTS" }, { status: 409 });
    }
    // Remove only this request's files; referenced files are protected by safeCleanupBlobs.
    await safeCleanupBlobs(newUrls);
    return NextResponse.json({ success: false, error: "CONTENT_CREATE_FAILED" }, { status: 500 });
  }
}
