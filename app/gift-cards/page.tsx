import { DeliveryType, ProductKind } from "@prisma/client";
import { db } from "@/lib/prisma";
import BrandGrid, { type BrandSummary } from "@/components/gift-cards/BrandGrid";
import { brandSlug, splitCategoryName } from "@/lib/gift-card-brands";
import styles from "./gift-cards.module.css";

export const dynamic = "force-dynamic";

export default async function GiftCardsPage() {
  const rows = await db.gameProduct.findMany({
    where: {
      active: true,
      kind: ProductKind.GIFT_CARD,
      deliveryType: DeliveryType.CODE,
    },
    take: 1000,
    select: {
      priceCents: true,
      currency: true,
      title: true,
      game: { select: { titleEn: true } },
    },
  });

  const map = new Map<string, BrandSummary & { regions: Set<string> }>();

  for (const row of rows) {
    const { brand, region } = splitCategoryName(row.game?.titleEn ?? row.title);
    const slug = brandSlug(brand);
    const entry = map.get(slug) ?? {
      brand,
      slug,
      regionCount: 0,
      cardCount: 0,
      minPriceCents: row.priceCents,
      currency: row.currency,
      regions: new Set<string>(),
    };

    entry.regions.add(region ?? "GLOBAL");
    entry.cardCount += 1;
    entry.minPriceCents = Math.min(entry.minPriceCents, row.priceCents);
    map.set(slug, entry);
  }

  const brands: BrandSummary[] = Array.from(map.values())
    .map((entry) => ({
      brand: entry.brand,
      slug: entry.slug,
      regionCount: entry.regions.size,
      cardCount: entry.cardCount,
      minPriceCents: entry.minPriceCents,
      currency: entry.currency,
    }))
    .sort((a, b) => a.brand.localeCompare(b.brand));

  return (
    <main className="wrap" dir="rtl">
      <header className={styles.header}>
        <div className="eyebrow">VORTEX STORE</div>
        <h1>بطاقات الهدايا</h1>
        <p className="muted">
          اختر نوع البطاقة ثم المنطقة والفئة. تُسلَّم البطاقة كودًا رقميًا بعد إتمام الدفع.
        </p>
      </header>

      {brands.length ? (
        <BrandGrid brands={brands} />
      ) : (
        <p className={styles.empty}>لا توجد بطاقات متاحة حاليًا. سنضيفها هنا قريبًا.</p>
      )}
    </main>
  );
}
