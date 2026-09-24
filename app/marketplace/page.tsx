import Link from "next/link";
import { ProductKind, SourceStatus } from "@prisma/client";
import BuyNowButton from "@/components/marketplace/BuyNowButton";
import { db } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function Marketplace() {
  const products = await db.gameProduct.findMany({
    where: {
      active: true,
      supplierVerified: true,
      kind: ProductKind.GAME_KEY,
      deliveryType: "CODE",
      game: {
        published: true,
        sourceStatus: { in: [SourceStatus.VERIFIED, SourceStatus.OFFICIAL_SOURCE] },
      },
    },
    include: { game: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <main className="wrap" dir="rtl">
      <div className="section-head">
        <div>
          <div className="eyebrow">VORTEX STORE</div>
          <h1>متجر مفاتيح الألعاب</h1>
          <p className="muted">نبيع في هذه المرحلة مفاتيح ألعاب رقمية موثقة فقط. يظهر المنتج هنا بعد التحقق من مصدر اللعبة والمورد وتوفر المخزون.</p>
        </div>
      </div>

      <div className="store-shell">
        <aside className="card side-panel">
          <h2>كيف يعمل الشراء؟</h2>
          <ol className="muted">
            <li>سجّل الدخول واختر مفتاح اللعبة المناسب لمنطقتك.</li>
            <li>أنشئ طلبًا آمنًا وانتقل إلى صفحة الدفع.</li>
            <li>بعد تأكيد الدفع، يظهر المفتاح في سجل طلباتك.</li>
          </ol>
          <hr />
          <p className="muted">لا تعرض هذه الصفحة المنتجات غير الموثقة أو غير المتاحة للبيع.</p>
          <Link className="btn secondary" href="/games">استكشف الألعاب</Link>
        </aside>

        <section className="grid" aria-label="منتجات المتجر">
          {products.map((product) => (
            <article className="card product" key={product.id}>
              <div className="product-meta">
                <span className="pill">مفتاح لعبة</span>
                <span className="pill">{product.region || "عالمي"}</span>
                {product.inventory !== null && <span className="pill">متاح: {product.inventory}</span>}
              </div>
              <h2>{product.title}</h2>
              <p className="muted">{product.game.titleAr || product.game.titleEn}</p>
              <div className="product-price">{(product.priceCents / 100).toFixed(2)} {product.currency}</div>
              <p className="muted">تسليم رقمي عبر مفتاح تفعيل. تحقق من المنطقة والمنصة قبل إتمام الدفع.</p>
              <BuyNowButton productId={product.id} productTitle={product.title} />
            </article>
          ))}

          {!products.length && (
            <div className="card">
              <h2>لا توجد مفاتيح جاهزة للبيع حاليًا</h2>
              <p className="muted">لن يظهر أي منتج قبل التحقق من مصدره ومورده وإعداد مخزونه للتسليم الآمن.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
