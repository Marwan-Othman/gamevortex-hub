import type { PrismaClient } from "@prisma/client";

export function normalizeCategorySlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function normalizeCategoryValues(value: unknown) {
  if (!Array.isArray(value)) return [];

  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 20);
}

export async function resolveCategoryIds(
  db: PrismaClient,
  values: unknown,
) {
  const normalized = normalizeCategoryValues(values);
  if (normalized.length === 0) return [];

  const categories = await db.category.findMany({
    where: {
      OR: normalized.flatMap((value) => {
        const slug = normalizeCategorySlug(value);
        return [
          { slug },
          { nameEn: { equals: value, mode: "insensitive" } },
          { nameAr: { equals: value, mode: "insensitive" } },
        ];
      }),
      active: true,
    },
    select: { id: true },
  });

  return Array.from(new Set(categories.map((category) => category.id)));
}

export async function ensureCategoryIds(
  db: PrismaClient,
  values: unknown,
) {
  const normalized = normalizeCategoryValues(values);
  if (normalized.length === 0) return [];

  const ids: string[] = [];

  for (const value of normalized) {
    const slug = normalizeCategorySlug(value);
    if (!slug) continue;

    const category = await db.category.upsert({
      where: { slug },
      update: { active: true },
      create: {
        slug,
        nameAr: value,
        nameEn: value,
        active: true,
      },
      select: { id: true },
    });

    ids.push(category.id);
  }

  return Array.from(new Set(ids));
}
