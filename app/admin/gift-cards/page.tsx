import Link from "next/link";
import { ProductKind } from "@prisma/client";
import { db } from "@/lib/prisma";
import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import FazerCardsImporter from "@/components/admin/FazerCardsImporter";
import ImportedGiftCards from "@/components/admin/ImportedGiftCards";

export const dynamic = "force-dynamic";

export default async function AdminGiftCards() {
  const gate = await getOwnerOrAccessScreen();
  if ("screen" in gate) return gate.screen;

  const hasApiKey = Boolean(process.env.FAZER_API_KEY?.trim());

  const products = await db.gameProduct.findMany({
    where: { kind: ProductKind.GIFT_CARD, provider: "fazercards" },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, title: true, priceCents: true, currency: true, active: true, inventory: true },
  });

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <Link href="/admin">← لوحة الإدارة</Link>
        <h1>بطاقات الهدايا (FazerCards)</h1>
        <p>
          اجلب الفئات والبطاقات من FazerCards واستوردها كمنتجات. المنتج المستورد يبقى غير مفعّل، فعّله من قائمة
          المنتجات المستوردة ليظهر في صفحة البطاقات. لا يتم شراء أي شيء من FazerCards في هذه المرحلة.
        </p>
        <Link href="/gift-cards">عرض صفحة البطاقات للزبائن ←</Link>
        {!hasApiKey && (
          <p className="muted">
            تنبيه: المتغير FAZER_API_KEY غير مضاف في إعدادات الاستضافة.
          </p>
        )}
      </section>

      <div className="section-head">
        <h2>الكتالوج</h2>
      </div>
      <FazerCardsImporter />

      <div className="section-head">
        <h2>المنتجات المستوردة ({products.length})</h2>
      </div>
      <ImportedGiftCards products={products} />
    </main>
  );
}
