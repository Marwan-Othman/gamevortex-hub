import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getOrCreateGamerProfile, xpForLevel } from "@/lib/gamer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "المكافآت | GameVortex Hub",
  description:
    "مستواك وXP ودرجة VIP ورصيد نقاطك في GameVortex Hub.",
};

const VIP_TIERS = [
  {
    key: "BRONZE",
    name: "Bronze",
    emoji: "🥉",
    description: "البداية في رحلة GameVortex.",
  },
  {
    key: "SILVER",
    name: "Silver",
    emoji: "🥈",
    description: "تقدم مستمر ومزايا إضافية.",
  },
  {
    key: "GOLD",
    name: "Gold",
    emoji: "🥇",
    description: "مستوى متقدم للاعبين النشطين.",
  },
  {
    key: "PLATINUM",
    name: "Platinum",
    emoji: "💎",
    description: "درجة VIP متقدمة.",
  },
  {
    key: "DIAMOND",
    name: "Diamond",
    emoji: "💠",
    description: "درجة VIP عالية داخل المنصة.",
  },
  {
    key: "APEX",
    name: "Apex",
    emoji: "👑",
    description: "أعلى درجة VIP المتاحة في النظام.",
  },
] as const;

export default async function RewardsPage() {
  const user = await requireUser().catch(() => null);

  if (!user) {
    return (
      <main className="wrap">
        <section className="hero">
          <div className="eyebrow">VORTEX REWARDS</div>

          <h1>المكافآت ومستوى VIP.</h1>

          <p>
            سجّل الدخول لمشاهدة مستوى اللاعب، XP، تقدمك نحو المستوى
            التالي، درجة VIP، ورصيد النقاط المتاح للسحوبات.
          </p>

          <div className="actions">
            <Link className="btn" href="/auth/login">
              تسجيل الدخول
            </Link>

            <Link className="btn secondary" href="/auth/register">
              إنشاء حساب
            </Link>
          </div>
        </section>
      </main>
    );
  }

  const profile = await getOrCreateGamerProfile(user.id);

  const currentLevelXp = xpForLevel(profile.level);
  const nextLevelXp = xpForLevel(profile.level + 1);

  const levelRange = Math.max(
    1,
    nextLevelXp - currentLevelXp,
  );

  const xpIntoLevel = Math.max(
    0,
    profile.xp - currentLevelXp,
  );

  const levelPct = Math.min(
    100,
    Math.max(
      0,
      (xpIntoLevel / levelRange) * 100,
    ),
  );

  const currentVip =
    VIP_TIERS.find(
      (tier) => tier.key === user.vipTier,
    ) ?? VIP_TIERS[0];

  return (
    <main className="wrap">
      {/* الصفحة الرئيسية للمكافآت */}
      <section className="hero">
        <div className="eyebrow">
          VORTEX REWARDS
        </div>

        <h1>
          مكافآتك ومستواك في GameVortex.
        </h1>

        <p>
          تابع تقدمك، XP، درجة VIP، ورصيد النقاط
          الذي يمكنك استخدامه في السحوبات.
        </p>

        <div className="actions">
          <Link
            className="btn"
            href="/draws"
          >
            السحوبات والجوائز
          </Link>

          <Link
            className="btn secondary"
            href="/referrals"
          >
            الإحالات
          </Link>
        </div>
      </section>

      {/* إحصائيات المستخدم */}
      <section
        className="stats"
        style={{ marginTop: 20 }}
      >
        <div className="stat">
          <strong>
            المستوى {profile.level}
          </strong>

          <span className="muted">
            مستواك الحالي
          </span>
        </div>

        <div className="stat">
          <strong>
            {profile.xp} XP
          </strong>

          <span className="muted">
            إجمالي XP
          </span>
        </div>

        <div className="stat">
          <strong>
            {user.points}
          </strong>

          <span className="muted">
            نقاط السحوبات
          </span>
        </div>

        <div className="stat">
          <strong>
            {currentVip.name}
          </strong>

          <span className="muted">
            درجة VIP الحالية
          </span>
        </div>
      </section>

      {/* تقدم المستوى */}
      <section
        className="card"
        style={{ marginTop: 20 }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <div>
            <span className="badge">
              LEVEL {profile.level}
            </span>

            <h2 style={{ marginBottom: 6 }}>
              التقدم نحو المستوى{" "}
              {profile.level + 1}
            </h2>

            <p
              className="muted"
              style={{ margin: 0 }}
            >
              {xpIntoLevel.toLocaleString("ar-EG")}
              {" / "}
              {levelRange.toLocaleString("ar-EG")}
              {" XP داخل هذا المستوى"}
            </p>
          </div>

          <strong>
            {Math.round(levelPct)}%
          </strong>
        </div>

        <div
          role="progressbar"
          aria-label="التقدم نحو المستوى التالي"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(levelPct)}
          style={{
            height: 12,
            borderRadius: 999,
            background:
              "rgba(255, 255, 255, .08)",
            overflow: "hidden",
            marginTop: 18,
          }}
        >
          <div
            style={{
              width: `${levelPct}%`,
              height: "100%",
              borderRadius: 999,
              background:
                "linear-gradient(90deg,#ead31f,#ff196e)",
              transition:
                "width .3s ease",
            }}
          />
        </div>

        <p
          className="muted"
          style={{ marginTop: 10 }}
        >
          تحتاج إلى{" "}
          {Math.max(
            0,
            nextLevelXp - profile.xp,
          ).toLocaleString("ar-EG")}{" "}
          XP للوصول إلى المستوى التالي.
        </p>
      </section>

      {/* مستويات VIP */}
      <section style={{ marginTop: 20 }}>
        <div
          className="hero"
          style={{ marginBottom: 20 }}
        >
          <div className="eyebrow">
            VIP STATUS
          </div>

          <h2>درجات VIP</h2>

          <p>
            درجة حسابك الحالية مميزة تلقائيًا
            داخل القائمة، دون تغيير بيانات الحساب
            من هذه الصفحة.
          </p>
        </div>

        <div className="feature-grid">
          {VIP_TIERS.map((tier) => {
            const active =
              tier.key === user.vipTier;

            return (
              <article
                className="card"
                key={tier.key}
                style={{
                  borderColor: active
                    ? "rgba(255, 25, 110, .65)"
                    : undefined,

                  boxShadow: active
                    ? "0 0 30px rgba(255, 25, 110, .12)"
                    : undefined,
                }}
              >
                <span className="badge">
                  {active
                    ? "مستواك الحالي"
                    : "VIP"}
                </span>

                <h2>
                  {tier.emoji} {tier.name}
                </h2>

                <p className="muted">
                  {tier.description}
                </p>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
