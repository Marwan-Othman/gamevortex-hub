import Link from "next/link";
import { db } from "../../lib/prisma";
import { requireOwner } from "../../lib/auth";
import flags from "../../config/feature-flags.json";

const ready = (value: boolean) => value ? "جاهز" : "غير مفعّل";

export default async function Admin() {
  const owner = await requireOwner();
  const [games, reciters, activeReciters, withdrawals, users, orders, reports, revenue, pendingOrders, openDraws, pendingReferrals, recentErrors] = await Promise.all([
    db.game.count(),
    db.quranReciter.count(),
    db.quranReciter.count({ where: { active: true, sourceVerificationStatus: "VERIFIED" } }),
    db.withdrawalRequest.count({ where: { status: { in: ["REQUESTED", "PENDING", "PROCESSING"] } } }),
    db.user.count(),
    db.order.count(),
    db.contentReport.count({ where: { status: "PENDING" } }),
    db.order.aggregate({ where: { status: "PAID" }, _sum: { totalCents: true } }),
    db.order.count({ where: { status: "PENDING" } }),
    db.raffle.count({ where: { status: "OPEN" } }),
    db.referral.count({ where: { status: "PENDING" } }),
    db.systemError.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
  ]);

  const operational = [
    ["المصادقة الإنتاجية", flags.productionAuth],
    ["مكتبة الألعاب", flags.gamingLibrary],
    ["المفضلة", flags.favorites],
    ["قائمة الرغبات", flags.wishlist],
    ["مشغل القرآن", flags.quranPlayer],
    ["AI Assistant", flags.aiAssistant],
    ["AI Search", flags.aiSmartSearch],
    ["AI Recommendations", flags.aiRecommendations],
    ["Payments", flags.payments],
    ["Gift Cards", flags.giftCards],
    ["Real Payout", flags.realPayout],
  ];

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <span className="badge">SUPER ADMIN</span>
        <h1>GameVortex Control Center</h1>
        <p>مرحباً {owner.username || owner.email}. هذه لوحة التشغيل المركزية للمنصة.</p>
        <div className="action-row">
          <Link className="btn" href="/admin/games">🎮 إدارة الألعاب</Link><Link className="btn" href="/admin/quran">🎙️ إدارة القرآن</Link>
          <Link className="btn" href="/admin/draws">🎁 إدارة السحوبات</Link>
          <Link className="btn secondary" href="/admin/moderation">🛡️ المراجعة والمحتوى</Link>
          <Link className="btn secondary" href="/admin/errors">🧯 سجل الأخطاء</Link>
          <Link className="btn secondary" href="/ai">🤖 مركز AI</Link>
        </div>
      </section>

      <section className="stats" aria-label="إحصائيات المنصة">
        {[
          [users, "المستخدمون"], [games, "الألعاب"], [orders, "الطلبات"],
          [pendingOrders, "طلبات قيد المعالجة"], [withdrawals, "سحوبات معلقة"],
          [reports, "بلاغات معلقة"], [`${((revenue._sum.totalCents || 0) / 100).toFixed(2)} USD`, "حجم المبيعات المدفوعة"],
          [`${activeReciters}/${reciters}`, "قراء القرآن المنشورون"],
          [openDraws, "سحوبات مفتوحة"], [pendingReferrals, "إحالات بانتظار التأهل"],
          [recentErrors, "أخطاء آخر 24 ساعة"]
        ].map(([value, label]) => (
          <div className="glass card" key={String(label)}>
            <strong>{value}</strong><span className="muted">{label}</span>
          </div>
        ))}
      </section>

      <section className="glass card">
        <div className="section-head"><h2>جاهزية المزايا</h2><span className="badge">V10</span></div>
        <div className="grid">
          {operational.map(([label, value]) => (
            <div className="feature-status" key={String(label)}>
              <strong>{String(label)}</strong>
              <span className={value ? "status-ready" : "status-off"}>{ready(Boolean(value))}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid feature-grid">
        <Link className="glass card admin-tile" href="/games"><h2>🎮</h2><h3>كتالوج الألعاب</h3><p className="muted">إدارة ومراجعة تجربة اكتشاف الألعاب.</p></Link>
        <Link className="glass card admin-tile" href="/library"><h2>📚</h2><h3>المكتبة</h3><p className="muted">متابعة حالة المكتبة والمفضلة وقائمة الرغبات.</p></Link>
        <Link className="glass card admin-tile" href="/recommendations"><h2>✨</h2><h3>التوصيات</h3><p className="muted">محرك التوصيات الحالي والجاهزية للذكاء الاصطناعي.</p></Link>
        <Link className="glass card admin-tile" href="/quran"><h2>📖</h2><h3>القرآن</h3><p className="muted">المصادر العامة والقراء الموثقون.</p></Link>
      </section>

      <section className="glass card warning-card">
        <h2>قبل الإنتاج النهائي</h2>
        <ul>
          <li>تهيئة PostgreSQL وتشغيل migrations.</li>
          <li>تكوين مزود الدفع والسحب وبطاقات الهدايا قبل تفعيلها.</li>
          <li>تكوين مزود AI حقيقي قبل تشغيل ميزات AI.</li>
          <li>تنفيذ اختبارات E2E وأمن وLoad Testing في بيئة staging.</li>
        </ul>
      </section>
    </main>
  );
}
