import Link from "next/link";
import {
  DeliveryType,
  ProductKind,
  SourceStatus,
} from "@prisma/client";
import { db } from "@/lib/prisma";
import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import StoreProductForm from "@/components/admin/StoreProductForm";
import StoreProductActions from "@/components/admin/StoreProductActions";

export const dynamic = "force-dynamic";

const productKindLabels: Record<ProductKind, string> = {
  GAME_KEY: "مفتاح لعبة",
  GIFT_CARD: "بطاقة هدية",
  TOP_UP: "شحن رصيد",
  DLC: "محتوى إضافي DLC",
  SUBSCRIPTION: "اشتراك",
  DIGITAL_ITEM: "عنصر رقمي",
};

const deliveryTypeLabels: Record<DeliveryType, string> = {
  CODE: "كود رقمي",
  ACCOUNT_TOPUP: "شحن حساب",
  EXTERNAL_LINK: "رابط خارجي",
  MANUAL: "تسليم يدوي",
};

function isCurrentlySellable(product: {
  active: boolean;
  supplierVerified: boolean;
  kind: ProductKind;
  deliveryType: DeliveryType;
  inventory: number | null;
  game: {
    published: boolean;
    sourceStatus: SourceStatus;
  };
  digitalKeys: {
    id: string;
  }[];
}) {
  const hasInventory =
    product.inventory !== null &&
    product.inventory > 0;

  const hasAvailableKey =
    product.digitalKeys.length > 0;

  const validGameSource =
    product.game.sourceStatus ===
      SourceStatus.VERIFIED ||
    product.game.sourceStatus ===
      SourceStatus.OFFICIAL_SOURCE;

  return (
    product.active &&
    product.supplierVerified &&
    (
      product.kind === ProductKind.GAME_KEY ||
      product.kind === ProductKind.GIFT_CARD
    ) &&
    product.deliveryType === DeliveryType.CODE &&
    product.game.published &&
    validGameSource &&
    (hasInventory || hasAvailableKey)
  );
}

function formatPrice(
  priceCents: number,
  currency: string,
) {
  return `${(priceCents / 100).toFixed(2)} ${currency}`;
}

export default async function AdminStore() {
  const gate =
    await getOwnerOrAccessScreen();

  if ("screen" in gate) {
    return gate.screen;
  }

  const products =
    await db.gameProduct.findMany({
      orderBy: {
        updatedAt: "desc",
      },
      take: 200,
      select: {
        id: true,
        sku: true,
        title: true,
        description: true,
        priceCents: true,
        currency: true,
        active: true,
        inventory: true,
        kind: true,
        deliveryType: true,
        region: true,
        country: true,
        provider: true,
        supplierVerified: true,
        updatedAt: true,

        game: {
          select: {
            id: true,
            titleAr: true,
            titleEn: true,
            slug: true,
            published: true,
            sourceStatus: true,
          },
        },

        digitalKeys: {
          where: {
            status: "AVAILABLE",
          },
          select: {
            id: true,
          },
          take: 1,
        },

        _count: {
          select: {
            orderItems: true,
            digitalKeys: true,
          },
        },
      },
    });

  const totalProducts =
    products.length;

  const activeProducts =
    products.filter(
      (product) => product.active,
    ).length;

  const inactiveProducts =
    products.filter(
      (product) => !product.active,
    ).length;

  const verifiedProducts =
    products.filter(
      (product) =>
        product.supplierVerified,
    ).length;

  const sellableProducts =
    products.filter((product) =>
      isCurrentlySellable(product),
    ).length;

  const productsByKind =
    Object.values(ProductKind).map(
      (kind) => ({
        kind,
        count: products.filter(
          (product) =>
            product.kind === kind,
        ).length,
      }),
    );

  return (
    <main
      className="wrap"
      dir="rtl"
    >
      <section className="glass hero">
        <div
          style={{
            display: "flex",
            justifyContent:
              "space-between",
            gap: "16px",
            alignItems:
              "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div>
            <Link href="/admin">
              ← لوحة الإدارة
            </Link>

            <h1>
              متجر المالك
            </h1>

            <p className="muted">
              مركز التحكم الكامل بمتجر
              GameVortex. من هنا يستطيع
              المالك إضافة المنتجات
              وتعديلها وإدارة المخزون
              والمفاتيح الرقمية ونشر
              المنتجات في متجر المستخدمين.
            </p>
          </div>

          <div
            style={{
              display: "flex",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            <Link
              className="btn secondary"
              href="/admin/gift-cards"
            >
              إدارة بطاقات الهدايا
            </Link>

            <Link
              className="btn secondary"
              href="/admin/games"
            >
              إدارة الألعاب
            </Link>

            <Link
              className="btn secondary"
              href="/marketplace"
            >
              عرض متجر المستخدمين
            </Link>
          </div>
        </div>
      </section>

      <section
        className="grid"
        aria-label="إحصائيات المتجر"
        style={{
          gridTemplateColumns:
            "repeat(auto-fit, minmax(180px, 1fr))",
          marginTop: "20px",
        }}
      >
        <article className="glass card">
          <span className="muted">
            إجمالي المنتجات
          </span>

          <h2>
            {totalProducts}
          </h2>
        </article>

        <article className="glass card">
          <span className="muted">
            منتجات نشطة
          </span>

          <h2>
            {activeProducts}
          </h2>
        </article>

        <article className="glass card">
          <span className="muted">
            منتجات غير نشطة
          </span>

          <h2>
            {inactiveProducts}
          </h2>
        </article>

        <article className="glass card">
          <span className="muted">
            مورد موثق
          </span>

          <h2>
            {verifiedProducts}
          </h2>
        </article>

        <article className="glass card">
          <span className="muted">
            قابلة للبيع حاليًا
          </span>

          <h2>
            {sellableProducts}
          </h2>
        </article>
      </section>

      <StoreProductForm />

      <section
        style={{
          marginTop: "28px",
        }}
      >
        <div className="section-head">
          <div>
            <h2>
              أنواع المنتجات
            </h2>

            <p className="muted">
              توزيع المنتجات الحالية
              حسب النوع.
            </p>
          </div>
        </div>

        <div
          className="grid"
          style={{
            gridTemplateColumns:
              "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          {productsByKind.map(
            ({
              kind,
              count,
            }) => (
              <article
                className="glass card"
                key={kind}
              >
                <span className="badge">
                  {
                    productKindLabels[
                      kind
                    ]
                  }
                </span>

                <h2
                  style={{
                    marginTop:
                      "12px",
                  }}
                >
                  {count}
                </h2>

                <p className="muted">
                  {kind}
                </p>
              </article>
            ),
          )}
        </div>
      </section>

      <section
        style={{
          marginTop: "28px",
        }}
      >
        <div className="section-head">
          <div>
            <h2>
              منتجات المتجر
            </h2>

            <p className="muted">
              آخر {products.length} منتجًا
              محدثًا في النظام.
            </p>
          </div>
        </div>

        <div className="grid">
          {products.map(
            (product) => {
              const sellable =
                isCurrentlySellable(
                  product,
                );

              const hasAvailableKey =
                product
                  .digitalKeys
                  .length > 0;

              const stockLabel =
                product.inventory ===
                null
                  ? hasAvailableKey
                    ? "مفتاح رقمي متاح"
                    : "مخزون غير محدد"
                  : product.inventory >
                      0
                    ? `المخزون: ${product.inventory}`
                    : "نفد المخزون";

              const publishReady =
                product.kind ===
                  ProductKind.GAME_KEY &&
                product.deliveryType ===
                  DeliveryType.CODE &&
                product.game.published &&
                (
                  product.game
                    .sourceStatus ===
                    SourceStatus.VERIFIED ||
                  product.game
                    .sourceStatus ===
                    SourceStatus.OFFICIAL_SOURCE
                ) &&
                hasAvailableKey;

              return (
                <article
                  className="glass card"
                  key={
                    product.id
                  }
                >
                  <div
                    style={{
                      display:
                        "flex",
                      justifyContent:
                        "space-between",
                      gap: "8px",
                      flexWrap:
                        "wrap",
                    }}
                  >
                    <span className="badge">
                      {
                        productKindLabels[
                          product
                            .kind
                        ]
                      }
                    </span>

                    <span className="badge">
                      {product.active
                        ? "منشور/نشط"
                        : "مسودة/مخفي"}
                    </span>
                  </div>

                  <h2
                    style={{
                      marginTop:
                        "14px",
                    }}
                  >
                    {
                      product.title
                    }
                  </h2>

                  <p className="muted">
                    SKU:{" "}
                    {
                      product.sku
                    }
                  </p>

                  <p>
                    {
                      product
                        .game
                        .titleAr ||
                      product
                        .game
                        .titleEn ||
                      product
                        .game
                        .slug
                    }
                  </p>

                  <div
                    style={{
                      display:
                        "grid",
                      gap: "6px",
                      marginTop:
                        "12px",
                    }}
                  >
                    <span>
                      السعر:{" "}
                      <strong>
                        {formatPrice(
                          product.priceCents,
                          product.currency,
                        )}
                      </strong>
                    </span>

                    <span className="muted">
                      التسليم:{" "}
                      {
                        deliveryTypeLabels[
                          product
                            .deliveryType
                        ]
                      }
                    </span>

                    <span className="muted">
                      {stockLabel}
                    </span>

                    <span className="muted">
                      المفاتيح الرقمية:{" "}
                      {
                        product
                          ._count
                          .digitalKeys
                      }
                    </span>

                    <span className="muted">
                      الطلبات:{" "}
                      {
                        product
                          ._count
                          .orderItems
                      }
                    </span>

                    {product.region && (
                      <span className="muted">
                        المنطقة:{" "}
                        {
                          product.region
                        }
                      </span>
                    )}

                    {product.country && (
                      <span className="muted">
                        الدولة:{" "}
                        {
                          product.country
                        }
                      </span>
                    )}

                    {product.provider && (
                      <span className="muted">
                        المورد:{" "}
                        {
                          product.provider
                        }
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      display:
                        "flex",
                      gap: "8px",
                      flexWrap:
                        "wrap",
                      marginTop:
                        "14px",
                    }}
                  >
                    <span className="badge">
                      {product
                        .supplierVerified
                        ? "المورد موثق"
                        : "المورد غير موثق"}
                    </span>

                    <span className="badge">
                      {product.game
                        .published
                        ? "اللعبة منشورة"
                        : "اللعبة غير منشورة"}
                    </span>

                    <span className="badge">
                      {
                        product.game
                          .sourceStatus
                      }
                    </span>

                    <span className="badge">
                      {sellable
                        ? "قابل للبيع"
                        : "غير قابل للبيع حاليًا"}
                    </span>

                    <span className="badge">
                      {publishReady
                        ? "جاهز للنشر"
                        : "غير جاهز للنشر"}
                    </span>
                  </div>

                  <p
                    className="muted"
                    style={{
                      marginTop:
                        "14px",
                    }}
                  >
                    آخر تحديث:{" "}
                    {product.updatedAt.toLocaleDateString(
                      "ar",
                    )}
                  </p>

                  <StoreProductActions
                    product={{
                      id: product.id,
                      sku: product.sku,
                      title: product.title,
                      description:
                        product.description,
                      priceCents:
                        product.priceCents,
                      currency:
                        product.currency,
                      active:
                        product.active,
                      inventory:
                        product.inventory,
                      kind: product.kind,
                      deliveryType:
                        product.deliveryType,
                      region:
                        product.region,
                      country:
                        product.country,
                      provider:
                        product.provider,
                      supplierVerified:
                        product.supplierVerified,
                      game: {
                        id: product
                          .game.id,
                        titleAr:
                          product
                            .game
                            .titleAr,
                        titleEn:
                          product
                            .game
                            .titleEn,
                        slug:
                          product
                            .game
                            .slug,
                      },
                      orderItems:
                        product
                          ._count
                          .orderItems,
                      digitalKeys:
                        product
                          ._count
                          .digitalKeys,
                    }}
                  />
                </article>
              );
            },
          )}

          {!products.length && (
            <article className="glass card">
              <h2>
                لا توجد منتجات
              </h2>

              <p className="muted">
                لم يتم العثور على أي
                GameProduct في قاعدة
                البيانات حتى الآن.
              </p>
            </article>
          )}
        </div>
      </section>

      <section
        className="glass card"
        style={{
          marginTop: "28px",
        }}
      >
        <h2>
          طريقة عمل متجر المالك
        </h2>

        <ul className="muted">
          <li>
            المنتجات الجديدة تبدأ
            غير نشطة وغير موثقة.
          </li>

          <li>
            المالك يضيف المنتج ثم
            يضيف المفاتيح الرقمية
            عند استخدام التسليم بالكود.
          </li>

          <li>
            المنتج المنشور يظهر
            تلقائيًا في متجر
            المستخدمين إذا استوفى
            شروط البيع.
          </li>

          <li>
            إخفاء المنتج من لوحة
            المالك يجعله غير ظاهر
            في متجر المستخدمين.
          </li>

          <li>
            لا يمكن حذف منتج مرتبط
            بطلبات سابقة.
          </li>

          <li>
            لا يمكن حذف منتج يحتوي
            على مفاتيح رقمية.
          </li>

          <li>
            الشراء الحالي عبر
            /api/me/orders يدعم
            مفاتيح الألعاب فقط.
          </li>

          <li>
            بطاقات الهدايا الحالية
            لها نظام FazerCards
            مستقل.
          </li>
        </ul>
      </section>
    </main>
  );
}
