"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import styles from "../../app/gift-cards/gift-cards.module.css";
import { brandTint, formatPrice } from "@/lib/gift-card-brands";

export type BrandSummary = {
  brand: string;
  slug: string;
  regionCount: number;
  cardCount: number;
  minPriceCents: number;
  currency: string;
};

export default function BrandGrid({ brands }: { brands: BrandSummary[] }) {
  const [query, setQuery] = useState("");

  const visible = brands.filter((item) =>
    item.brand.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <section>
      {brands.length > 6 && (
        <input
          className={`input ${styles.search}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث عن بطاقة، مثال: Amazon"
          aria-label="ابحث عن بطاقة"
        />
      )}

      <div className={styles.brandGrid}>
        {visible.map((item) => {
          const tint = brandTint(item.brand);
          return (
            <Link
              key={item.slug}
              href={`/gift-cards/${item.slug}`}
              className={styles.brandTile}
              style={{ "--from": tint.from, "--to": tint.to } as CSSProperties}
            >
              <span className={styles.monogram}>{item.brand.charAt(0).toUpperCase()}</span>
              <h2 className={styles.brandName}>{item.brand}</h2>
              <span className={styles.brandMeta}>
                {item.regionCount} منطقة · {item.cardCount} فئة
              </span>
              <span className={styles.fromPrice}>
                من {formatPrice(item.minPriceCents, item.currency)}
              </span>
            </Link>
          );
        })}
      </div>

      {!visible.length && <p className={styles.empty}>لا توجد نتائج مطابقة.</p>}
    </section>
  );
}
