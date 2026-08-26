import Link from "next/link";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getOrCreateGamerProfile, xpForLevel } from "@/lib/gamer";

export const dynamic = "force-dynamic";

const TIERS = [
  ["BRONZE", "البداية", "XP أساسي"],
  ["SILVER", "الفضي", "مضاعف مكافآت"],
  ["GOLD", "الذهبي", "عروض ومهام خاصة"],
  ["PLATINUM", "البلاتيني", "مكافآت أعلى"],
  ["DIAMOND", "الماسي", "امتيازات متقدمة"],
  ["APEX", "APEX", "أعلى مستوى"],
] as const;

export default async function Rewards() {
  const user = await requireUser().catch(() => null);
  const profile = user ? await getOrCreateGamerProfile(user.id) : null;

  const currentLevelXp = profile ? xpForLevel(profile.level) : 0;
  const nextLevelXp = profile ? xpForLevel(profile.level + 1) : 0;
  const xpIntoLevel = profile ? Math.max(0, profile.xp - currentLevelXp) : 0;
  const xpSpan = Math.max(1, nextLevelXp - currentLevelXp);
  const progressPct = profile ? Math.min(100, Math.round((xpIntoLevel / xpSpan) * 100)) : 0;

  return (
    <main className="wrap">
      <section className="hero">
        <div className="eyebrow">VORTEX REWARDS</div>
        <h1>العب أكثر. اكسب أكثر.</h1>
        <p>نظام مكافآت مستقل داخل GameVortex. المستويات والمكافآت مرتبطة ببيانات النظام ولا تعتمد على منصة خارجية.</p>
        <div className="actions">
          <Link className="btn" href="/profile/gamer">افتح ملف اللاعب</Link>
          <Link className="btn secondary" href="/referrals">الإحالات</Link>
        </div>
      </section>

      {user && profile ? (
        <section className="card" style={{ marginTop: 20 }}>
          <span className="badge">{user.vipTier}</span>
          <h2>المستوى {profile.level} · {profile.xp.toLocaleString()} XP</h2>
          <div className="progress-track" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="muted">{Math.max(0, nextLevelXp - profile.xp).toLocaleString()} XP للوصول إلى المستوى {profile.level + 1}</p>
          <p><strong>رصيد النقاط:</strong> {user.points.toLocaleString()} نقطة (تُستخدم لدخول السحوبات في <Link href="/draws">Vortex Draws</Link>)</p>
        </section>
      ) : (
        <section className="card" style={{ marginTop: 20 }}>
          <h2>سجّل الدخول لعرض تقدمك</h2>
          <p className="muted">المستوى، XP، النقاط، ودرجة VIP خاصة بحسابك وتظهر بعد تسجيل الدخول.</p>
        </section>
      )}

      <div className="grid" style={{ marginTop: 20 }}>
        {TIERS.map(([key, name, desc]) => (
          <div className={`card${user?.vipTier === key ? " tier-active" : ""}`} key={key}>
            <span className="badge">{key}</span>
            <h2>{name}</h2>
            <p className="muted">{desc}</p>
            {user?.vipTier === key && <p className="muted">مستواك الحالي</p>}
          </div>
        ))}
      </div>

      <section className="feature-grid">
        <div className="card"><h2>XP</h2><p className="muted">الأحداث المؤهلة تمنح XP مرة واحدة وفق قواعد الخادم.</p></div>
        <div className="card"><h2>النقاط</h2><p className="muted">نظام نقاط داخلي يمكن ربطه بالمهام والمكافآت والمشتريات المؤهلة.</p></div>
        <div className="card"><h2>VIP</h2><p className="muted">المستوى محفوظ داخل حساب GameVortex ويمكن تغيير قواعده من الإدارة.</p></div>
      </section>
    </main>
  );
}
