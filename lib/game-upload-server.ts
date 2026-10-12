import { BlobNotFoundError, del, head } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import {
  COVER_CONTENT_TYPES,
  MAX_COVER_FILE_SIZE,
  MAX_GAME_FILE_SIZE,
  canonicalBlobUrl,
  type UploadKind,
} from "@/lib/game-upload-shared";
import { detectImageType, looksLikeApk } from "@/lib/content-admin";

const KINDS: readonly UploadKind[] = ["game", "mod", "cover"];

function blobToken(): { token: string } | Record<string, never> {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  return token ? { token } : {};
}

/** Canonicalizes against any of the allowed upload folders. Null when the URL is not ours. */
export function canonicalAnyBlobUrl(value: unknown): string | null {
  for (const kind of KINDS) {
    const canonical = canonicalBlobUrl(value, kind);
    if (canonical) return canonical;
  }
  return null;
}

/**
 * Checks whether a set of uploaded files is already referenced by a Game, App or Mod.
 * Screenshots are PostgreSQL text arrays (not JSON); we fetch the screenshot arrays along with
 * rows matched by scalar URLs and compare in JavaScript, avoiding array operators on JSONB
 * columns in databases whose deployed schema has drifted from Prisma's schema.
 */
export async function findReferencedBlobUrls(canonicalUrls: readonly string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(canonicalUrls));
  if (!unique.length) return new Set();

  const [games, apps, mods] = await Promise.all([
    prisma.game.findMany({
      where: {
        OR: unique.flatMap((url) => [
          { downloadSource: { startsWith: url } },
          { coverUrl: { startsWith: url } },
        ]),
      },
      select: { downloadSource: true, coverUrl: true, screenshots: true },
    }),
    prisma.app.findMany({
      where: {
        OR: unique.flatMap((url) => [
          { downloadSource: { startsWith: url } },
          { coverUrl: { startsWith: url } },
          { iconUrl: { startsWith: url } },
        ]),
      },
      select: { downloadSource: true, coverUrl: true, iconUrl: true, screenshots: true },
    }),
    prisma.mod.findMany({
      where: {
        OR: unique.flatMap((url) => [
          { downloadUrl: { startsWith: url } },
          { imageUrl: { startsWith: url } },
        ]),
      },
      select: { downloadUrl: true, imageUrl: true },
    }),
  ]);

  const stored: string[] = [];
  for (const game of games) {
    if (game.downloadSource) stored.push(game.downloadSource);
    if (game.coverUrl) stored.push(game.coverUrl);
    if (Array.isArray(game.screenshots)) stored.push(...game.screenshots);
  }
  for (const app of apps) {
    if (app.downloadSource) stored.push(app.downloadSource);
    if (app.coverUrl) stored.push(app.coverUrl);
    if (app.iconUrl) stored.push(app.iconUrl);
    if (Array.isArray(app.screenshots)) stored.push(...app.screenshots);
  }
  for (const mod of mods) {
    if (mod.downloadUrl) stored.push(mod.downloadUrl);
    if (mod.imageUrl) stored.push(mod.imageUrl);
  }

  const referenced = new Set<string>();
  for (const url of unique) {
    if (stored.some((value) => value === url || value.startsWith(`${url}?`))) referenced.add(url);
  }
  return referenced;
}

export type CleanupResult = { deleted: number; skippedReferenced: number; skippedInvalid: number };

/**
 * Deletes uploaded Blob files that belong to a failed operation.
 * It never deletes URLs that are not GameVortex upload URLs, and never deletes
 * files that an existing Game or Mod already references.
 */
export async function deleteUnreferencedBlobs(urls: readonly string[]): Promise<CleanupResult> {
  const canonical: string[] = [];
  let skippedInvalid = 0;
  for (const url of new Set(urls)) {
    const value = canonicalAnyBlobUrl(url);
    if (value) canonical.push(value);
    else skippedInvalid += 1;
  }
  if (!canonical.length) return { deleted: 0, skippedReferenced: 0, skippedInvalid };

  const referenced = await findReferencedBlobUrls(canonical);
  const deletable = canonical.filter((url) => !referenced.has(url));
  if (deletable.length) await del(deletable, blobToken());
  return { deleted: deletable.length, skippedReferenced: referenced.size, skippedInvalid };
}

/** Best-effort cleanup that never throws and never logs URLs or secrets. */
export async function safeCleanupBlobs(urls: readonly string[]): Promise<void> {
  try {
    await deleteUnreferencedBlobs(urls);
  } catch (error) {
    console.error("Blob cleanup failed:", error instanceof Error ? error.message : "UNKNOWN");
  }
}

/**
 * Resolves category identifiers sent by the admin upload forms.
 * The forms send existing Category IDs; slugs/names are also accepted. Unknown values are
 * ignored: unlike ensureCategoryIds(), this never creates categories out of raw IDs.
 */
export async function resolveUploadCategoryIds(values: readonly string[]): Promise<string[]> {
  const unique = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, 20);
  if (!unique.length) return [];

  const byId = await prisma.category.findMany({
    where: { id: { in: unique }, active: true },
    select: { id: true },
  });
  const foundIds = new Set(byId.map((category) => category.id));
  const remaining = unique.filter((value) => !foundIds.has(value));

  if (remaining.length) {
    const { resolveCategoryIds } = await import("@/lib/categories");
    for (const id of await resolveCategoryIds(prisma, remaining)) foundIds.add(id);
  }
  return Array.from(foundIds);
}

export type UploadedFileCheck = { url: string; kind: "apk" | "file" | "image" };

/** First bytes of a stored file. Never downloads more than one chunk. Returns null when it cannot be read. */
async function readFileHead(url: string, length: number): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url, {
      headers: { Range: `bytes=0-${length - 1}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    const chunk = await reader.read();
    // A host that ignores Range would stream the whole file: stop after the first chunk.
    await reader.cancel().catch(() => undefined);
    return chunk.value ? chunk.value.slice(0, length) : null;
  } catch {
    return null;
  }
}

/**
 * Server-side check of files the browser uploaded straight to Blob (the file never passes through
 * our server, so the real content is only verifiable after the upload):
 *  - the file exists in Blob storage and is not empty,
 *  - the stored size is within the limits,
 *  - images are real JPEG/PNG/WEBP/AVIF (checked by signature, not by name or browser MIME type),
 *  - an Android file is a real APK (ZIP signature).
 * Returns an error code, or null when everything is fine. A temporary storage/network failure
 * never blocks a save (it is logged); a missing or wrong file always does.
 */
export async function verifyUploadedFiles(checks: readonly UploadedFileCheck[]): Promise<string | null> {
  const unique = Array.from(new Map(checks.map((check) => [check.url, check])).values());
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();

  const results = await Promise.all(
    unique.map(async (check): Promise<string | null> => {
      try {
        const info = await head(check.url, token ? { token } : {});
        if (!Number.isFinite(info.size) || info.size <= 0) return "UPLOADED_FILE_EMPTY";

        if (check.kind === "image") {
          if (info.size > MAX_COVER_FILE_SIZE) return "COVER_FILE_TOO_LARGE";
          const declared = (info.contentType ?? "").toLowerCase().split(";")[0].trim();
          if (!(COVER_CONTENT_TYPES as readonly string[]).includes(declared)) return "INVALID_IMAGE_FILE";
          const bytes = await readFileHead(check.url, 16);
          if (bytes && !detectImageType(bytes)) return "INVALID_IMAGE_FILE";
          return null;
        }

        if (info.size > MAX_GAME_FILE_SIZE) return "GAME_FILE_TOO_LARGE";
        if (check.kind === "apk") {
          const bytes = await readFileHead(check.url, 4);
          if (bytes && !looksLikeApk(bytes)) return "INVALID_APK_FILE";
        }
        return null;
      } catch (error) {
        if (error instanceof BlobNotFoundError) return "UPLOADED_FILE_MISSING";
        console.error("Upload verification skipped:", error instanceof Error ? error.message : "UNKNOWN");
        return null;
      }
    }),
  );

  return results.find((code): code is string => code !== null) ?? null;
}
