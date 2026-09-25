import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { DeliveryType, ProductKind } from "@prisma/client";
import { db } from "@/lib/prisma";
import {
  brandSlug,
  brandTint,
  cardLabel,
  formatPrice,
  regionInfo,
  splitCategoryName,
} from "@/lib/gift-card-brands";
import styles from "../gift-cards.module.css";

export const dynamic = "force-dynamic";

export default async function GiftCardBrandPage({
  params,
}: {
  params: Promise<{ brand: string }>;
}) {
  const { brand: slug } = await params;

  const rows = await db.gameProduct.findMany({
    where: {
      active: true,
      kind: ProductKind.GIFT_CARD,
      deliveryType: DeliveryType.CODE,
    },
    orderBy: { priceCents: "asc" },
    take: 1000,
    select: {
      id: true,
      title: true,
      priceCents: true,
      currency: true,
      inventory: true,
      game: { select: { titleEn: true } },
    },
  });

  const items = rows
    .map((row) => {
      const { brand, region } = splitCategoryName(row.game?.titleEn ?? row.title);
      return { ...row, brand, region };
    })
    .filter((row) => brandSlug(row.brand) === slug);

  if (!items.length) notFound();

  const brandName = items[0].brand;
  const tint = brandTint(brandName);

  const byRegion = new Map<string, typeof items>();
  for (const item of items) {
    const key = regionInfo(item.region).code;
    const list = byRegion.get(key) ?? [];
    list.push(item);
    byRegion.set(key, list);
  }

  const regions = Array.from(byRegion.entries())
    .map(([code, list]) => ({ code, info: regionInfo(list[0].region), list }))
    .sort((a, b) => {
      if (a.code === "GLOBAL") return -1;
      if (b.code === "GLOBAL") return 1;
      return a.code.localeCompare(b.code);
    });

  return (
    <main className="wrap" dir="rtl">
      <Link href="/gift-cards" className={styles.backLink}>
        ← كل البطاقات
      </Link>

      <div className={styles.brandHead} style={{ "--from": tint.from, "--to": tint.to } as CSSProperties}>
        <span className={`${styles.monogram} ${styles.monogramLarge}`}>
          {brandName.charAt(0).toUpperCase()}
        </span>
        <div>
          <h1>{brandName}</h1>
          <span className={styles.brandMeta}>
            {regions.length} منطقة · {items.length} فئة
          </span>
        </div>
      </div>

      <p className={styles.notice}>الشراء المباشر لهذه البطاقات سيتوفر قريبًا.</p>

      {regions.length > 1 && (
        <nav className={styles.regionNav} aria-label="المناطق">
          {regions.map((region) => (
            <a key={region.code} href={`#region-${region.code}`} className={styles.regionChip}>
              {region.info.flag} {region.info.name}
            </a>
          ))}
        </nav>
      )}

      {regions.map((region) => (
        <section key={region.code} id={`region-${region.code}`} className={styles.regionBox}>
          <div className={styles.regionHead}>
            <h2>
              {region.info.flag} {region.info.name}
            </h2>
            <span className="pill">{region.list.length} فئة</span>
          </div>

          <div className={styles.denomGrid}>
            {region.list.map((item) => {
              const soldOut = item.inventory !== null && item.inventory <= 0;
              return (
                <div
                  key={item.id}
                  className={`${styles.denomTile} ${soldOut ? styles.soldOut : ""}`}
                >
                  <span className={styles.denomLabel}>{cardLabel(item.title)}</span>
                  <span className={styles.denomPrice}>{formatPrice(item.priceCents, item.currency)}</span>
                  {soldOut && <span className="pill">نفد المخزون</span>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </main>
  );
}
