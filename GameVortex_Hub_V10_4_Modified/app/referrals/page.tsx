import Link from "next/link";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ensureReferralCode } from "@/lib/referrals";
import CopyReferralLink from "@/components/referrals/CopyReferralLink";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "بانتظار أول عملية شراء",
  QUALIFIED: "مؤهّل",
  REWARDED: "تمت المكافأة",
  REJECTED: "مرفوض",
};

export default async function Referrals() {
  const user = await requireUser().catch(() => null);

  if (!user) {
    return (
      <main className="wrap">
        <section className="hero">
          <div className="eyebrow">VORTEX REFERRALS</div>
          <h1>ابنِ مجتمعك داخل GameVortex.</h1>
          <p>لكل لاعب رمز إحالة مستقل. عند تحقق شروط التأهل، يمكن للنظام منح المكافأة مرة واحدة مع تسجيل العملية في السجل.</p>
        </section>
        <section className="card" style={{ marginTop: 20 }}>
          <h2>سجّل الدخول لعرض رمز الإحالة الخاص بك</h2>
          <Link className="btn" href="/auth/login">تسجيل الدخول</Link>
        </section>
      </main>
    );
  }

  const referralCode = await ensureReferralCode(user.id, user.username, user.referralCode);
  const referrals = await db.referral.findMany({
    where: { referrerId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { referred: { select: { username: true } } },
  });
  const rewardedPoints = referrals.reduce((sum, r) => sum + (r.status === "REWARDED" ? r.rewardPoints : 0), 0);
  const origin = process.env.APP_ORIGIN?.replace(/\/$/, "") || "";
  const link = `${origin}/auth/register?ref=${referralCode}`;

  return (
    <main className="wrap">
      <section className="hero">
        <div className="eyebrow">VORTEX REFERRALS</div>
        <h1>ابنِ مجتمعك داخل GameVortex.</h1>
        <p>لكل لاعب رمز إحالة مستقل. عند تحقق شروط التأهل، يمكن للنظام منح المكافأة مرة واحدة مع تسجيل العملية في السجل.</p>
        <div className="actions">
          <Link className="btn" href="/profile/gamer">ملفي</Link>
          <Link className="btn secondary" href="/rewards">المكافآت</Link>
        </div>
      </section>

      <section className="card" style={{ marginTop: 20 }}>
        <span className="badge">رمزك: {referralCode}</span>
        <h2>رابط الإحالة الخاص بك</h2>
        <CopyReferralLink link={link} />
      </section>

      <section className="stats">
        <div className="stat"><strong>{referrals.length}</strong><span className="muted">دعوات مرسلة</span></div>
        <div className="stat"><strong>{referrals.filter((r) => r.status === "REWARDED").length}</strong><span className="muted">مكتملة ومكافأة</span></div>
        <div className="stat"><strong>{rewardedPoints}</strong><span className="muted">نقطة مكتسبة من الإحالات</span></div>
      </section>

      <section className="feature-grid">
        <div className="card"><h2>1 · شارك الرمز</h2><p className="muted">رمز إحالة فريد محفوظ في حسابك.</p></div>
        <div className="card"><h2>2 · تحقق</h2><p className="muted">لا توجد مكافأة بمجرد إنشاء حساب؛ يجب تحقق شروط التأهل (أول عملية شراء مكتملة).</p></div>
        <div className="card"><h2>3 · اكسب</h2><p className="muted">المكافأة تسجل مرة واحدة وتظهر في سجل النشاط.</p></div>
      </section>

      {referrals.length > 0 && (
        <section className="card" style={{ marginTop: 20 }}>
          <h2>سجل الإحالات</h2>
          <table className="referral-table">
            <thead><tr><th>المستخدم</th><th>الحالة</th><th>النقاط</th></tr></thead>
            <tbody>
              {referrals.map((r) => (
                <tr key={r.id}>
                  <td>{r.referred.username || "—"}</td>
                  <td>{STATUS_LABEL[r.status] ?? r.status}</td>
                  <td>{r.status === "REWARDED" ? r.rewardPoints : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
