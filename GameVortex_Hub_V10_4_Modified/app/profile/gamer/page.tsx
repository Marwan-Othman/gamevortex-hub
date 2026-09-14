import Link from "next/link";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getOrCreateGamerProfile, xpForLevel } from "@/lib/gamer";
import WeeklyXpChart from "@/components/profile/WeeklyXpChart";
import PlatformLibraryDonut from "@/components/profile/PlatformLibraryDonut";
import styles from "../profile.module.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "ملفي الشخصي | GameVortex Hub", description: "مستواك، إنجازاتك، ومكتبتك في GameVortex Hub." };

const WEEKDAYS_AR = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const PLATFORM_COLORS = ["#8b5cf6", "#4f8fff", "#3ddc84", "#ffc65c", "#ff6b81", "#34d8ff"];

function platformOf(platform: string | null | undefined) {
  return (platform || "أخرى").split(",")[0]?.trim() || "أخرى";
}

export default async function GamerProfilePage() {
  let user;
  try {
    user = await requireUser();
  } catch {
    return (
      <main className={styles.page}>
        <section className={styles.loginPrompt}>
          <h1>سجّل الدخول لعرض ملفك الشخصي</h1>
          <p className="muted">تحتاج لتسجيل الدخول لمشاهدة المستوى والإنجازات والمكتبة الخاصة بك.</p>
          <Link href="/auth/login">تسجيل الدخول</Link>
        </section>
      </main>
    );
  }

  const profile = await getOrCreateGamerProfile(user.id);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    achievementsCount,
    unreadNotifications,
    libraryCount,
    libraryRecent,
    libraryForStats,
    xpEvents,
    recentOrders,
    achievements,
  ] = await Promise.all([
    db.userAchievement.count({ where: { profileId: profile.id } }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    db.gameLibraryItem.count({ where: { userId: user.id } }),
    db.gameLibraryItem.findMany({ where: { userId: user.id }, include: { game: true }, orderBy: { updatedAt: "desc" }, take: 6 }),
    db.gameLibraryItem.findMany({ where: { userId: user.id }, select: { game: { select: { platform: true } } }, take: 300 }),
    db.xpEvent.findMany({ where: { profileId: profile.id, createdAt: { gte: sevenDaysAgo } }, select: { amount: true, createdAt: true } }),
    db.order.findMany({
      where: { userId: user.id, status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { items: { include: { product: true } } },
    }),
    db.userAchievement.findMany({ where: { profileId: profile.id }, include: { achievement: true }, orderBy: { unlockedAt: "desc" }, take: 6 }),
  ]);

  // ---- weekly XP chart ----
  const dayBuckets = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(sevenDaysAgo);
    d.setDate(d.getDate() + i + 1);
    return { date: d, label: WEEKDAYS_AR[d.getDay()].slice(0, 3), value: 0 };
  });
  for (const event of xpEvents) {
    const idx = dayBuckets.findIndex((b) => b.date.toDateString() === event.createdAt.toDateString());
    if (idx >= 0) dayBuckets[idx].value += event.amount;
  }
  const weeklyXpTotal = dayBuckets.reduce((sum, b) => sum + b.value, 0);

  // ---- platform distribution from the library ----
  const platformTotals = new Map<string, number>();
  for (const item of libraryForStats) {
    const key = platformOf(item.game?.platform);
    platformTotals.set(key, (platformTotals.get(key) ?? 0) + 1);
  }
  const platformSegments = [...platformTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, value], i) => ({ label, value, color: PLATFORM_COLORS[i % PLATFORM_COLORS.length] }));

  const currentLevelXp = xpForLevel(profile.level);
  const nextLevelXp = xpForLevel(profile.level + 1);
  const levelPct = Math.min(100, Math.max(0, ((profile.xp - currentLevelXp) / Math.max(1, nextLevelXp - currentLevelXp)) * 100));
  const hours = Math.floor(profile.totalPlayMinutes / 60);
  const initial = (profile.displayName || user.username || user.email).trim().charAt(0).toUpperCase();

  const statTiles = [
    { label: "عدد الألعاب", value: libraryCount, icon: <IconLibrary /> },
    { label: "ساعات اللعب", value: `${hours}h`, icon: <IconClock /> },
    { label: "الإنجازات", value: achievementsCount, icon: <IconTrophy /> },
    { label: "نقاطي", value: user.points, icon: <IconCoins /> },
  ];

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroTop}>
          <div className={styles.avatarWrap}>
            <span className={styles.avatar}>{initial}</span>
            <span className={styles.levelBadge}>{profile.level}</span>
          </div>
          <div className={styles.identity}>
            <div className={styles.name}>
              {profile.displayName || user.username || "لاعب"} <span title="موثّق">✔️</span>
            </div>
            <span className={styles.vipBadge}>👑 {user.vipTier}</span>
          </div>
        </div>

        <div className={styles.progressRow}>
          <span className={styles.progressLabel}>LVL {profile.level}</span>
          <div className={styles.progressBar}><div className={styles.progressFill} style={{ width: `${levelPct}%` }} /></div>
          <span className={styles.progressLabel}>{Math.round(levelPct)}%</span>
        </div>

        <div className={styles.actionRow}>
          <span className={styles.actionBtn}>الملف الشخصي</span>
          <span className={`${styles.actionBtn} ${styles.soonBtn}`}>المهام (قريبًا)</span>
          <a href="#achievements" className={styles.actionBtn}>الإنجازات</a>
        </div>
      </section>

      <section>
        <div className={styles.panelHead}><span>إحصائيات اللعب</span></div>
        <div className={styles.statsGrid}>
          {statTiles.map((s) => (
            <div className={styles.statTile} key={s.label}>
              <span className={styles.statIcon}>{s.icon}</span>
              <strong>{s.value}</strong>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      <div className={styles.chartsGrid}>
        <WeeklyXpChart points={dayBuckets.map((b) => ({ label: b.label, value: b.value }))} totalLabel={`+${weeklyXpTotal} XP`} />
        <PlatformLibraryDonut segments={platformSegments} centerValue={String(libraryCount)} centerLabel="لعبة" />
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <span>آخر المشتريات</span>
          <Link href="/orders">عرض الكل</Link>
        </div>
        {recentOrders.map((order) => (
          <div className={styles.listItem} key={order.id}>
            <span className={styles.listIcon}><IconReceipt /></span>
            <div className={styles.listMain}>
              <strong>{order.items[0]?.product.title}{order.items.length > 1 ? ` +${order.items.length - 1}` : ""}</strong>
              <span>{new Date(order.createdAt).toLocaleDateString("ar-EG")}</span>
            </div>
            <span className={styles.listPrice}>${(order.totalCents / 100).toFixed(2)}</span>
            <span className={styles.statusBadge}>مكتمل</span>
          </div>
        ))}
        {!recentOrders.length && <p className="muted">لا توجد مشتريات مكتملة بعد.</p>}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <span>أحدث الألعاب في مكتبتك</span>
          <Link href="/library">عرض الكل</Link>
        </div>
        <div className={styles.hscroll}>
          {libraryRecent.map((item) => (
            <Link href={`/games/${item.game.slug}`} key={item.id} className={styles.gameCard}>
              <div className={styles.gameCoverWrap}>
                {item.game.coverUrl && <img src={item.game.coverUrl} alt={item.game.titleAr} loading="lazy" />}
              </div>
              <div className={styles.gameInfo}>
                <strong>{item.game.titleAr}</strong>
                <span>★ {item.game.ratingAverage.toFixed(1)}</span>
              </div>
            </Link>
          ))}
          {!libraryRecent.length && <p className="muted">مكتبتك فارغة — أضف أول لعبة من صفحة الألعاب.</p>}
        </div>
      </section>

      <section className={styles.banner}>
        <div className={styles.bannerText}>
          <h2>بطاقاتك المجانية</h2>
          <p>احصل على بطاقات هدايا لأشهر المنصات ضمن برنامج المكافآت</p>
          <Link href="/rewards" className={styles.bannerBtn}>تصفح البطاقات</Link>
        </div>
        <span className={styles.bannerIcon}><IconGift /></span>
      </section>

      <section id="achievements" className={styles.panel}>
        <div className={styles.panelHead}>
          <span>الإنجازات</span>
          <span style={{ color: "#a78bfa" }}>{achievementsCount} إنجاز · {unreadNotifications} إشعار غير مقروء</span>
        </div>
        <div className={styles.achievementsGrid}>
          {achievements.map(({ id, achievement }) => (
            <article className={styles.achievementCard} key={id}>
              <span className={styles.achievementIcon}>{achievement.icon || "🏆"}</span>
              <div className={styles.achievementMeta}>
                <strong>{achievement.name}</strong>
                <p>{achievement.description}</p>
                <span>{achievement.rarity} · +{achievement.xpReward} XP</span>
              </div>
            </article>
          ))}
          {!achievements.length && <p className="muted">لسه مفيش إنجازات مفتوحة — ابدأ استكشاف GameVortex.</p>}
        </div>
      </section>
    </main>
  );
}

function IconLibrary() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="4" /><path d="M7 10v4M5 12h4M15.5 11.5h.01M18 13.5h.01" /></svg>; }
function IconClock() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></svg>; }
function IconTrophy() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 4h8v4a4 4 0 0 1-8 0z" /><path d="M8 5H5a3 3 0 0 0 3 3M16 5h3a3 3 0 0 1-3 3M10 15v3h4v-3M8 21h8" /></svg>; }
function IconCoins() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>; }
function IconReceipt() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" /></svg>; }
function IconGift() { return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="8" width="18" height="13" rx="1" /><path d="M12 8v13M3 12h18M12 8c-1.5 0-3-1-3-2.5S10 3 12 4c0-1 1.5-2 3-2.5S18 3 18 4.5 16.5 8 12 8z" /></svg>; }
