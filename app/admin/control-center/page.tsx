import Link from "next/link";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import AdminShell from "@/components/admin/AdminShell";
import { calculateOwnerCashSummary } from "@/lib/owner-points";
import WalletOrderRefunds from "@/components/admin/WalletOrderRefunds";
import styles from "../admin.module.css";

export const dynamic = "force-dynamic";

function status(value: boolean) {
  return value ? "مفعّل" : "غير مفعّل";
}

export default async function OwnerControlCenter() {
  let owner;
  try {
    owner = await requireOwner();
  } catch {
    return (
      <main className="wrap" dir="rtl">
        <section className="glass card" style={{ margin: "40px auto", maxWidth: 620, textAlign: "center" }}>
          <h1>غير مصرح</h1>
          <p className="muted">مركز التحكم الكامل متاح لحساب SUPER_ADMIN فقط.</p>
        </section>
      </main>
    );
  }

  const [
    users,
    games,
    publishedGames,
    products,
    orders,
    withdrawals,
    vipPlans,
    mobileGames,
    ownerWallet,
    withdrawalTotals,
    recentWalletOrders,
  ] = await Promise.all([
    db.user.count(),
    db.game.count(),
    db.game.count({ where: { published: true } }),
    db.gameProduct.count(),
    db.order.count(),
    db.withdrawalRequest.count(),
    db.vipPlan.count({ where: { active: true } }),
    db.game.count({ where: { gamePlatforms: { some: { platform: { in: ["ANDROID", "IOS"] } } }, published: true } }),
    db.ownerWallet.findUnique({
      where: { ownerId: owner.id },
      select: { id: true, availablePoints: true, pendingPoints: true },
    }),
    db.withdrawalRequest.groupBy({
      by: ["status"],
      _sum: { usdAmount: true },
    }),

    db.order.findMany({
      where: {
        payments: {
          some: {
            provider: "wallet",
            status: { in: ["SUCCEEDED", "REFUNDED"] },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        totalCents: true,
        currency: true,
        status: true,
        createdAt: true,
        user: { select: { username: true, email: true } },
      },
    }),
  ]);

  const revenueGroups = ownerWallet
    ? await db.ownerLedger.groupBy({
        by: ["type"],
        where: {
          walletId: ownerWallet.id,
          currency: "USD",
          type: { in: ["CREDIT_REVENUE", "REFUND"] },
        },
        _sum: { usdAmount: true },
      })
    : [];

  const grossUsd = Number(
    revenueGroups.find((entry) => entry.type === "CREDIT_REVENUE")?._sum.usdAmount ?? 0,
  );
  const refundsUsd = Math.abs(
    Number(revenueGroups.find((entry) => entry.type === "REFUND")?._sum.usdAmount ?? 0),
  );
  const paidOutUsd = withdrawalTotals
    .filter((entry) => ["PAID", "SETTLED"].includes(entry.status))
    .reduce((sum, entry) => sum + Number(entry._sum.usdAmount ?? 0), 0);
  const pendingOutUsd = withdrawalTotals
    .filter((entry) => ["REQUESTED", "PENDING", "PROCESSING"].includes(entry.status))
    .reduce((sum, entry) => sum + Number(entry._sum.usdAmount ?? 0), 0);

  const ownerCash = calculateOwnerCashSummary({
    grossUsd,
    refundsUsd,
    paidOutUsd,
    pendingOutUsd,
    availablePoints: ownerWallet?.availablePoints ?? 0,
    pendingPoints: ownerWallet?.pendingPoints ?? 0,
  });

  const integrations = [
    ["RAWG Mobile Catalog", Boolean(process.env.RAWG_API_KEY), "/admin/games"],
    ["Payments", Boolean(process.env.PAYMENT_PROVIDER || process.env.PAYMENT_PROVIDER_BASE_URL), "/admin/errors"],
    ["Quran Provider", Boolean(process.env.QURAN_PROVIDER_BASE_URL || process.env.QURAN_PROVIDER_API_KEY), "/admin/quran"],
  ] as const;

  const modules = [
    ["الألعاب والكتالوج", "/admin/games", `${publishedGames} منشورة من ${games}`],
    ["استيراد ألعاب الهاتف", "/admin/games", `${mobileGames} ألعاب Android/iOS منشورة`],
    ["المتجر", "/admin/store", `${products} منتج`],
    ["VIP", "/vip", `${vipPlans} خطط نشطة`],
    ["المدفوعات والسحوبات", "/admin/errors", `${orders} طلب · ${withdrawals} سحب`],
    ["مفاتيح API", "/admin/api-keys", "إصدار وإلغاء ومراقبة"],
    ["الدعم الفني", "/admin/support", "تذاكر المستخدمين"],
    ["محفظة الأموال", "/wallet", "محفظة المستخدم المالية"],
    ["القرآن", "/admin/quran", "إدارة المصادر والقراء"],
    ["المراجعة والمحتوى", "/admin/moderation", "بلاغات ومراجعة المحتوى"],
    ["السحوبات", "/admin/draws", "إدارة السحوبات"],
  ] as const;

  return (
    <AdminShell ownerLabel={owner.username || owner.email}>
      <section className={styles.ownerCard}>
        <div className={styles.ownerCardTop}>
          <span className={styles.ownerCardAvatar}>{(owner.username || owner.email).charAt(0).toUpperCase()}</span>
          <div>
            <div className={styles.ownerCardName}>Owner Control Center 👑</div>
            <div className={styles.ownerCardMeta}>SUPER_ADMIN · التحكم يتم من الخادم وليس من الواجهة فقط</div>
          </div>
        </div>
      </section>

      <section>
        <div className={styles.panelHead}><span>ملخص المنصة</span></div>
        <div className={styles.overviewGrid}>
          {[['المستخدمون', users], ['الألعاب', games], ['الألعاب المنشورة', publishedGames], ['ألعاب الهاتف', mobileGames], ['المنتجات', products], ['الخطط VIP', vipPlans]].map(([label, value]) => (
            <div className={styles.overviewTile} key={String(label)}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.panel} style={{ marginTop: 18 }}>
        <div className={styles.panelHead}><span>المحافظ</span></div>
        <div className={styles.indicatorRow}>
          <div className={styles.indicatorTile}><strong>{ownerWallet?.availablePoints ?? 0}</strong><span>نقاط المالك المتاحة</span></div>
          <div className={styles.indicatorTile}><strong>{ownerWallet?.pendingPoints ?? 0}</strong><span>نقاط المالك المعلقة</span></div>
          <div className={styles.indicatorTile}><strong>${ownerCash.cashAvailableUsd.toFixed(2)}</strong><span>الرصيد النقدي الحقيقي المتاح</span></div>
          <div className={styles.indicatorTile}><strong>${ownerCash.pointsBalanceUsd.toFixed(2)}</strong><span>قيمة نقاط المالك بالدولار</span></div>
          <Link href="/profile/gamer" className={styles.indicatorTile}><strong>→</strong><span>ملف الحساب</span></Link>
        </div>
      </section>

      <section className={styles.panel} style={{ marginTop: 18 }}>
        <div className={styles.panelHead}><span>سجل الإيرادات بالدولار</span></div>
        <p className="muted">مبالغ مؤكدة عبر Webhook الدفع، قبل رسوم المزود والتسوية البنكية؛ ليست رصيدًا متاحًا للسحب.</p>
        <div className={styles.indicatorRow}>
          <div className={styles.indicatorTile}><strong>${ownerCash.grossUsd.toFixed(2)}</strong><span>إجمالي المبيعات المسجلة</span></div>
          <div className={styles.indicatorTile}><strong>${ownerCash.refundsUsd.toFixed(2)}</strong><span>المبالغ المستردة</span></div>
          <div className={styles.indicatorTile}><strong>${ownerCash.netRevenueUsd.toFixed(2)}</strong><span>الصافي المسجل قبل الرسوم</span></div>
          <div className={styles.indicatorTile}><strong>${ownerCash.paidOutUsd.toFixed(2)}</strong><span>السحوبات المدفوعة</span></div>
          <div className={styles.indicatorTile}><strong>${ownerCash.pendingOutUsd.toFixed(2)}</strong><span>السحوبات المعلقة</span></div>
        </div>
      </section>

      <WalletOrderRefunds
        orders={recentWalletOrders.map((order) => ({
          id: order.id,
          userLabel: order.user.username || order.user.email,
          totalCents: order.totalCents,
          currency: order.currency,
          status: order.status,
          createdAt: order.createdAt.toISOString(),
        }))}
      />

      <section style={{ marginTop: 18 }}>
        <div className={styles.panelHead}><span>الأنظمة والتكاملات</span></div>
        <div className={styles.actionGrid}>
          {integrations.map(([name, configured, href]) => (
            <Link href={href} key={name} className={styles.actionBtn}>
              <span aria-hidden="true">{configured ? "●" : "○"}</span>
              <span>{name}</span>
              <small style={{ marginInlineStart: "auto", opacity: .7 }}>{status(configured)}</small>
            </Link>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 18 }}>
        <div className={styles.panelHead}><span>إدارة الأنظمة</span></div>
        <div className={styles.actionGrid}>
          {modules.map(([label, href, meta]) => (
            <Link href={href} key={label} className={styles.actionBtn}>
              <span>{label}</span>
              <small style={{ marginInlineStart: "auto", opacity: .65 }}>{meta}</small>
            </Link>
          ))}
        </div>
      </section>

      <section className="glass card" style={{ marginTop: 18 }}>
        <h2>قواعد الحماية</h2>
        <ul className="muted" style={{ lineHeight: 1.9 }}>
          <li>المفتاح الحقيقي للمالك هو role = SUPER_ADMIN، وليس البريد المرسل من المتصفح.</li>
          <li>لا يتم عرض API Keys أو Secrets في هذا المركز.</li>
          <li>التغييرات الحساسة يجب أن تمر عبر API محمي وتُسجل في AuditLog.</li>
          <li>وجود التكامل هنا يعني فقط أن Environment Variable موجود، وليس أن الخدمة نجحت فعليًا.</li>
        </ul>
      </section>
    </AdminShell>
  );
}
