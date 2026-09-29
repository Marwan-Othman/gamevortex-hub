import Link from "next/link";
import { db } from "../../lib/prisma";
import { requireOwner } from "../../lib/auth";
import { pointsToUsd } from "../../lib/owner-points";
import AdminShell from "@/components/admin/AdminShell";
import RevenueLineChart from "@/components/admin/RevenueLineChart";
import PlatformDonutChart from "@/components/admin/PlatformDonutChart";
import styles from "./admin.module.css";

export const dynamic = "force-dynamic";

const WEEKDAYS_AR = [
  "الأحد",
  "الإثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

const PLATFORM_COLORS = [
  "#8B5CFF",
  "#27D7FF",
  "#7CFFB2",
  "#FFD45A",
  "#FF6B9D",
  "#A66CFF",
];

const AUDIT_LABELS: Record<string, string> = {
  GAMES_BULK_IMPORT_RAWG_DETAILED: "تم استيراد ألعاب من RAWG",
  GAMES_BULK_PUBLISH_VERIFIED: "تم نشر ألعاب موثقة",
  OWNER_WITHDRAWAL_REQUESTED: "طلب سحب جديد",
};

function timeAgo(date: Date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) {
    return `منذ ${seconds} ثانية`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `منذ ${minutes} دقيقة`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `منذ ${hours} ساعة`;
  }

  const days = Math.floor(hours / 24);

  return `منذ ${days} يوم`;
}

function platformOf(platform: string | null) {
  return (platform || "أخرى").split(",")[0]?.trim() || "أخرى";
}

export default async function Admin() {
  let owner;

  try {
    owner = await requireOwner();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "FORBIDDEN";

    return (
      <main className="wrap" dir="rtl">
        <section
          className={styles.panel}
          style={{
            textAlign: "center",
            padding: 60,
            margin: "40px auto",
            maxWidth: 480,
          }}
        >
          {message === "UNAUTHORIZED" ? (
            <>
              <h1>سجّل الدخول للوصول للوحة التحكم</h1>

              <p
                className="muted"
                style={{ margin: "10px 0 20px" }}
              >
                تحتاج لتسجيل الدخول بحساب المالك للوصول إلى هذه الصفحة.
              </p>

              <Link href="/auth/login" className="btn">
                تسجيل الدخول
              </Link>
            </>
          ) : (
            <>
              <h1>ليس لديك صلاحية الوصول</h1>

              <p
                className="muted"
                style={{ margin: "10px 0 20px" }}
              >
                هذه الصفحة مخصصة لحساب المالك
                (SUPER_ADMIN) فقط. سجّل الدخول بالحساب الصحيح إذا كنت
                تعتقد أن هذا خطأ.
              </p>

              <Link href="/" className="btn">
                العودة للرئيسية
              </Link>
            </>
          )}
        </section>
      </main>
    );
  }

  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000
  );

  const monthStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  );

  const [
    ownerWallet,
    games,
    users,
    ordersTotal,
    pendingOrders,
    completedOrdersCount,
    monthlyCompletedOrders,
    withdrawalsPending,
    withdrawalsPaidAgg,
    reportsPending,
    revenueAgg,
    activeReciters,
    reciters,
    openDraws,
    pendingReferrals,
    recentErrors,
    availableKeys,
    recentOrders,
    recentOrderItems,
    recentActivity,
    latestUsers,
    latestGames,
    latestProducts,
  ] = await Promise.all([
    db.ownerWallet.findUnique({
      where: {
        ownerId: owner.id,
      },
    }),

    db.game.count(),

    db.user.count(),

    db.order.count(),

    db.order.count({
      where: {
        status: "PENDING",
      },
    }),

    db.order.count({
      where: {
        status: "COMPLETED",
      },
    }),

    db.order.count({
      where: {
        status: "COMPLETED",
        createdAt: {
          gte: monthStart,
        },
      },
    }),

    db.withdrawalRequest.count({
      where: {
        status: {
          in: ["REQUESTED", "PENDING", "PROCESSING"],
        },
      },
    }),

    db.withdrawalRequest.aggregate({
      where: {
        status: {
          in: ["PAID", "SETTLED"],
        },
      },
      _sum: {
        usdAmount: true,
      },
    }),

    db.contentReport.count({
      where: {
        status: "PENDING",
      },
    }),

    db.order.aggregate({
      where: {
        status: "COMPLETED",
      },
      _sum: {
        totalCents: true,
      },
    }),

    db.quranReciter.count({
      where: {
        active: true,
        sourceVerificationStatus: "VERIFIED",
      },
    }),

    db.quranReciter.count(),

    db.raffle.count({
      where: {
        status: "OPEN",
      },
    }),

    db.referral.count({
      where: {
        status: "PENDING",
      },
    }),

    db.systemError.count({
      where: {
        createdAt: {
          gte: new Date(
            Date.now() - 24 * 60 * 60 * 1000
          ),
        },
      },
    }),

    db.digitalKey.count({
      where: {
        status: "AVAILABLE",
      },
    }),

    db.order.findMany({
      where: {
        status: "COMPLETED",
        createdAt: {
          gte: sevenDaysAgo,
        },
      },
      select: {
        totalCents: true,
        createdAt: true,
      },
    }),

    db.orderItem.findMany({
      where: {
        order: {
          status: "COMPLETED",
        },
      },
      select: {
        quantity: true,
        unitPriceCents: true,
        product: {
          select: {
            game: {
              select: {
                platform: true,
              },
            },
          },
        },
      },
      take: 500,
    }),

    db.auditLog.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 5,
    }),

    db.user.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 4,
      select: {
        id: true,
        username: true,
        email: true,
        createdAt: true,
      },
    }),

    db.game.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 6,
      select: {
        id: true,
        slug: true,
        titleAr: true,
        coverUrl: true,
        platform: true,
      },
    }),

    db.gameProduct.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 6,
      select: {
        id: true,
        title: true,
        priceCents: true,
        kind: true,
        game: {
          select: {
            coverUrl: true,
          },
        },
      },
    }),
  ]);

  const dayBuckets = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(sevenDaysAgo);

    d.setDate(d.getDate() + i + 1);

    return {
      date: d,
      label: WEEKDAYS_AR[d.getDay()],
      value: 0,
    };
  });

  for (const order of recentOrders) {
    const dayIndex = dayBuckets.findIndex(
      (bucket) =>
        bucket.date.toDateString() ===
        order.createdAt.toDateString()
    );

    if (dayIndex >= 0) {
      dayBuckets[dayIndex].value +=
        order.totalCents / 100;
    }
  }

  const weeklyRevenue = dayBuckets.reduce(
    (sum, bucket) => sum + bucket.value,
    0
  );

  const platformTotals = new Map<string, number>();

  for (const item of recentOrderItems) {
    const key = platformOf(
      item.product.game?.platform ?? null
    );

    platformTotals.set(
      key,
      (platformTotals.get(key) ?? 0) +
        (item.unitPriceCents * item.quantity) / 100
    );
  }

  const platformSegments = [...platformTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value], index) => ({
      label,
      value,
      color:
        PLATFORM_COLORS[
          index % PLATFORM_COLORS.length
        ],
    }));

  const totalRevenue =
    (revenueAgg._sum.totalCents || 0) / 100;

  const totalWithdrawn = Number(
    withdrawalsPaidAgg._sum.usdAmount || 0
  );

  const ownerProfit = ownerWallet
    ? pointsToUsd(ownerWallet.availablePoints)
    : 0;

  const avgOrderValue =
    completedOrdersCount > 0
      ? totalRevenue / completedOrdersCount
      : 0;

  const initial = (owner.username || owner.email)
    .trim()
    .charAt(0)
    .toUpperCase();

  const overview = [
    {
      label: "الألعاب",
      value: games,
      color: "#8B5CFF",
      icon: <IconGames />,
    },
    {
      label: "المستخدمون",
      value: users,
      color: "#27D7FF",
      icon: <IconUsers />,
    },
    {
      label: "الطلبات",
      value: ordersTotal,
      color: "#A66CFF",
      icon: <IconOrders />,
    },
    {
      label: "طلبات معلقة",
      value: pendingOrders,
      color: "#FFD45A",
      icon: <IconClock />,
    },
    {
      label: "سحوبات معلقة",
      value: withdrawalsPending,
      color: "#7CFFB2",
      icon: <IconWithdraw />,
    },
    {
      label: "بلاغات معلقة",
      value: reportsPending,
      color: "#FF6B9D",
      icon: <IconFlag />,
    },
  ];

  return (
    <AdminShell ownerLabel={owner.username || owner.email}>
      <div className={styles.dashboard} dir="rtl">

        {/* OWNER HEADER */}
        <section className={styles.ownerCard}>
          <div className={styles.ownerCardTop}>
            <span className={styles.ownerCardAvatar}>
              {initial}
            </span>

            <div className={styles.ownerIdentity}>
              <div className={styles.ownerCardName}>
                {owner.username || "المالك"}
                <span
                  className={styles.verifiedBadge}
                  title="حساب المالك"
                >
                  ✓
                </span>
              </div>

              <div className={styles.ownerCardMeta}>
                <span className={styles.dot} />
                متصل الآن
                <span className={styles.metaSeparator}>•</span>
                المالك الرئيسي
                <span className={styles.ownerRole}>
                  SUPER_ADMIN
                </span>
              </div>
            </div>
          </div>

          <div className={styles.statGrid}>
            <div className={styles.statTile}>
              <span className={styles.statIcon}>
                $
              </span>

              <div>
                <strong>
                  ${totalRevenue.toFixed(2)}
                </strong>

                <span className={styles.label}>
                  إجمالي الإيرادات
                </span>
              </div>
            </div>

            <div className={styles.statTile}>
              <span className={styles.statIcon}>
                ↓
              </span>

              <div>
                <strong>
                  ${totalWithdrawn.toFixed(2)}
                </strong>

                <span className={styles.label}>
                  إجمالي السحوبات
                </span>
              </div>
            </div>

            <div className={styles.statTile}>
              <span className={styles.statIcon}>
                #
              </span>

              <div>
                <strong>
                  {completedOrdersCount}
                </strong>

                <span className={styles.label}>
                  إجمالي المبيعات
                </span>
              </div>
            </div>

            <div className={styles.statTile}>
              <span className={styles.statIcon}>
                ✦
              </span>

              <div>
                <strong>
                  ${ownerProfit.toFixed(2)}
                </strong>

                <span className={styles.label}>
                  الأرباح المتاحة
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* OVERVIEW */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>
            <span className={styles.titleAccent} />
            <span>نظرة عامة على المنصة</span>
          </div>

          <div className={styles.overviewGrid}>
            {overview.map((item) => (
              <div
                className={styles.overviewTile}
                key={item.label}
                style={
                  {
                    "--icon-color": item.color,
                  } as React.CSSProperties
                }
              >
                <span className={styles.overviewIcon}>
                  {item.icon}
                </span>

                <strong>{item.value}</strong>

                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* CHARTS */}
        <section className={styles.chartsGrid}>
          <div className={styles.chartPanel}>
            <RevenueLineChart
              points={dayBuckets.map((bucket) => ({
                label: bucket.label.slice(0, 3),
                value: bucket.value,
              }))}
              totalLabel={`$${weeklyRevenue.toFixed(2)}`}
            />
          </div>

          <div className={styles.chartPanel}>
            <PlatformDonutChart
              segments={platformSegments}
              centerLabel="الإجمالي"
              centerValue={`$${totalRevenue.toFixed(0)}`}
            />
          </div>
        </section>

        {/* MANAGEMENT */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>
            <span className={styles.titleAccent} />
            <span>إدارة المنصة</span>
          </div>

          <div className={styles.actionGrid}>
            <Link
              href="/admin/games"
              className={styles.actionBtn}
            >
              <IconGames />
              <span>إدارة الألعاب</span>
            </Link>

            <Link
              href="/admin/apps"
              className={styles.actionBtn}
            >
              <IconGames />
              <span>إدارة التطبيقات</span>
            </Link>

            <Link
              href="/admin/wallpapers"
              className={styles.actionBtn}
            >
              <IconWallpaper />
              <span>إدارة الخلفيات</span>
            </Link>

            <Link
              href="/admin/content-health"
              className={styles.actionBtn}
            >
              <IconShield />
              <span>صحة المحتوى</span>
            </Link>

            <Link
              href="/admin/quran"
              className={styles.actionBtn}
            >
              <IconQuran />
              <span>إدارة القرآن</span>
            </Link>

            <Link
              href="/admin/draws"
              className={styles.actionBtn}
            >
              <IconDraws />
              <span>إدارة السحوبات</span>
            </Link>

            <Link
              href="/admin/moderation"
              className={styles.actionBtn}
            >
              <IconShield />
              <span>المراجعة والمحتوى</span>
            </Link>

            <Link
              href="/admin/gift-cards"
              className={styles.actionBtn}
            >
              <IconCards />
              <span>بطاقات الهدايا</span>
            </Link>

            <Link
              href="/admin/trading"
              className={`${styles.actionBtn} ${styles.tradingBtn}`}
            >
              <IconTrading />
              <span>GameVortex AI Trading</span>
            </Link>
          </div>
        </section>

        {/* RECENT ACTIVITY + USERS */}
        <div className={styles.listGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <span>النشاطات الأخيرة</span>
              <span className={styles.panelBadge}>
                LIVE
              </span>
            </div>

            {recentActivity.map((activity) => (
              <div
                className={styles.listItem}
                key={activity.id}
              >
                <span className={styles.listAvatar}>
                  •
                </span>

                <div className={styles.listMain}>
                  <strong>
                    {AUDIT_LABELS[activity.action] ||
                      activity.action.replaceAll("_", " ")}
                  </strong>
                </div>

                <span className={styles.listTime}>
                  {timeAgo(activity.createdAt)}
                </span>
              </div>
            ))}

            {!recentActivity.length && (
              <p className={styles.emptyState}>
                لا توجد نشاطات مسجلة بعد.
              </p>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.panelHead}>
              <span>آخر المستخدمين المسجلين</span>
              <span className={styles.panelBadge}>
                USERS
              </span>
            </div>

            {latestUsers.map((user) => (
              <div
                className={styles.listItem}
                key={user.id}
              >
                <span className={styles.listAvatar}>
                  {(user.username || user.email)
                    .charAt(0)
                    .toUpperCase()}
                </span>

                <div className={styles.listMain}>
                  <strong>
                    {user.username || user.email}
                  </strong>

                  <span>
                    مستخدم جديد
                  </span>
                </div>

                <span className={styles.listTime}>
                  {timeAgo(user.createdAt)}
                </span>
              </div>
            ))}

            {!latestUsers.length && (
              <p className={styles.emptyState}>
                لا يوجد مستخدمون بعد.
              </p>
            )}
          </section>
        </div>

        {/* GAMES */}
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <span>أحدث الألعاب المضافة</span>

            <Link
              href="/admin/games"
              className={styles.panelLink}
            >
              عرض الكل
            </Link>
          </div>

          <div className={styles.mediaRow}>
            {latestGames.map((game) => (
              <Link
                href={`/games/${game.slug}`}
                key={game.id}
                className={styles.mediaCard}
              >
                <div className={styles.mediaCover}>
                  {game.coverUrl ? (
                    <img
                      src={game.coverUrl}
                      alt={game.titleAr}
                      loading="lazy"
                    />
                  ) : (
                    <span>بدون صورة</span>
                  )}
                </div>

                <div className={styles.mediaInfo}>
                  <strong>{game.titleAr}</strong>
                  <span>
                    {platformOf(game.platform)}
                  </span>
                </div>
              </Link>
            ))}

            {!latestGames.length && (
              <p className={styles.emptyState}>
                لا توجد ألعاب بعد.
              </p>
            )}
          </div>
        </section>

        {/* PRODUCTS */}
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <span>أحدث المنتجات المضافة</span>

            <span className={styles.panelBadge}>
              STORE
            </span>
          </div>

          <div className={styles.mediaRow}>
            {latestProducts.map((product) => (
              <div
                key={product.id}
                className={styles.mediaCard}
              >
                <div className={styles.mediaCover}>
                  {product.game?.coverUrl ? (
                    <img
                      src={product.game.coverUrl}
                      alt={product.title}
                      loading="lazy"
                    />
                  ) : (
                    <span>بدون صورة</span>
                  )}
                </div>

                <div className={styles.mediaInfo}>
                  <strong>{product.title}</strong>

                  <span>
                    ${(product.priceCents / 100).toFixed(2)}
                    {" · "}
                    {product.kind}
                  </span>
                </div>
              </div>
            ))}

            {!latestProducts.length && (
              <p className={styles.emptyState}>
                لا توجد منتجات بعد.
              </p>
            )}
          </div>
        </section>

        {/* SYSTEM INDICATORS */}
        <section className={styles.indicatorRow}>
          <div className={styles.indicatorTile}>
            <strong>{availableKeys}</strong>
            <span>مفاتيح متاحة في المخزون</span>
          </div>

          <div className={styles.indicatorTile}>
            <strong>
              ${avgOrderValue.toFixed(2)}
            </strong>
            <span>متوسط قيمة الطلب</span>
          </div>

          <div className={styles.indicatorTile}>
            <strong>{monthlyCompletedOrders}</strong>
            <span>مبيعات هذا الشهر</span>
          </div>

          <div className={styles.indicatorTile}>
            <strong>
              {activeReciters}/{reciters}
            </strong>
            <span>قراء القرآن الموثقون</span>
          </div>
        </section>

        {/* ALERTS */}
        {(openDraws > 0 ||
          pendingReferrals > 0 ||
          recentErrors > 0) && (
          <section className={styles.alertGrid}>
            {openDraws > 0 && (
              <div className={styles.alertTile}>
                <strong>{openDraws}</strong>
                <span>سحوبات مفتوحة</span>
              </div>
            )}

            {pendingReferrals > 0 && (
              <div className={styles.alertTile}>
                <strong>{pendingReferrals}</strong>
                <span>إحالات بانتظار التأهل</span>
              </div>
            )}

            {recentErrors > 0 && (
              <div className={styles.alertTile}>
                <strong>{recentErrors}</strong>
                <span>أخطاء آخر 24 ساعة</span>
              </div>
            )}

            <Link
              href="/admin/errors"
              className={styles.errorLink}
            >
              <strong>→</strong>
              <span>سجل الأخطاء الكامل</span>
            </Link>
          </section>
        )}

      </div>
    </AdminShell>
  );
}

function IconGames() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect
        x="2"
        y="6"
        width="20"
        height="12"
        rx="4"
      />
      <path d="M7 10v4M5 12h4" />
      <path d="M15.5 11.5h.01M18 13.5h.01" />
    </svg>
  );
}

function IconWallpaper() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2"
      />
      <circle
        cx="8.5"
        cy="8.5"
        r="1.5"
      />
      <path d="m21 15-5-5L5 21" />
      <path d="m14 14 2-2 5 5" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M18 8v5M15.5 10.5h5" />
    </svg>
  );
}

function IconOrders() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect
        x="4"
        y="4"
        width="16"
        height="17"
        rx="2"
      />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </svg>
  );
}

function IconWithdraw() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 2v14" />
      <path d="M6 10l6 6 6-6" />
      <path d="M4 20h16" />
    </svg>
  );
}

function IconFlag() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M5 21V4h13l-3 4 3 4H5" />
    </svg>
  );
}

function IconQuran() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z" />
      <path d="M18 4v16" />
    </svg>
  );
}

function IconDraws() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M20 12v9H4v-9" />
      <path d="M2 7h20v5H2z" />
      <path d="M12 7v14" />
      <path d="M12 7c-2 0-3-1.5-3-3s1-3 3-3 3 1.5 3 3-1 3-3 3z" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5z" />
    </svg>
  );
}

function IconCards() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect
        x="2"
        y="6"
        width="20"
        height="14"
        rx="2"
      />
      <path d="M2 10h20" />
    </svg>
  );
}

function IconTrading() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M4 17l5-5 4 3 7-8" />
      <path d="M17 7h3v3" />
      <path d="M4 21h16" />
    </svg>
  );
}
