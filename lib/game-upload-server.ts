import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { canonicalBlobUrl, type UploadKind } from "@/lib/game-upload-shared";

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
 * Returns the subset of canonical URLs that are already referenced by a Game or a Mod.
 * Stored URLs may carry a `?download=1` query from older uploads, hence the prefix match.
 */
export async function findReferencedBlobUrls(canonicalUrls: readonly string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(canonicalUrls));
  if (!unique.length) return new Set();

  const [games, mods] = await Promise.all([
    prisma.game.findMany({
      where: {
        OR: unique.flatMap((url) => [
          { downloadSource: { startsWith: url } },
          { coverUrl: { startsWith: url } },
        ]),
      },
      select: { downloadSource: true, coverUrl: true },
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
