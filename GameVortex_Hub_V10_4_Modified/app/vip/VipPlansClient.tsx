"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import styles from "./vip.module.css";

type Plan = {
  code: string;
  kind: string;
  emoji: string;
  nameAr: string;
  nameEn: string;
  priceCents: number;
  priceLabel: string;
  currency: string;
  durationMonths: number | null;
  purchasable: boolean;
  pointsMultiplier: number;
  chatCredits: number;
  imageCredits: number;
  videoCredits: number;
};

type Status = {
  isOwner: boolean;
  isVip: boolean;
  status: string;
  planCode: string;
  subscriptionId: string | null;
  startedAt: string | null;
  expiresAt: string | null;
  points: number;
  pointsMultiplier: number;
  chatCredits: number;
  imageCredits: number;
  videoCredits: number;
};

const PLAN_DESCRIPTIONS: Record<string, string> = {
  FREE:
    "ابدأ مجانًا واستمتع بالميزات الأساسية داخل GameVortex Hub.",

  VIP_1M:
    "خطة مناسبة لتجربة مزايا VIP والحصول على رصيد AI ونقاط أكثر.",

  VIP_3M:
    "ثلاثة أشهر من مزايا VIP مع رصيد AI أكبر ومضاعف نقاط أفضل.",

  VIP_6M:
    "خطة طويلة تمنحك رصيدًا أكبر ومضاعف نقاط قوي ومزايا حصرية.",

  VIP_1Y:
    "تجربة VIP الكاملة لمدة سنة مع أعلى مضاعف نقاط ورصيد AI كبير.",

  OWNER:
    "عضوية المالك الدائمة مع جميع مزايا VIP وصلاحيات المالك.",
};

const PLAN_ACCENTS: Record<string, string> = {
  FREE: styles.free,
  VIP_1M: styles.bronze,
  VIP_3M: styles.blue,
  VIP_6M: styles.gold,
  VIP_1Y: styles.purple,
  OWNER: styles.owner,
};

const PLAN_LABELS: Record<string, string> = {
  FREE: "البداية",
  VIP_1M: "شهر واحد",
  VIP_3M: "3 أشهر",
  VIP_6M: "6 أشهر",
  VIP_1Y: "سنة كاملة",
  OWNER: "للمالك فقط",
};

function makeIdempotencyKey() {
  if (
    typeof crypto !== "undefined" &&
    "randomUUID" in crypto
  ) {
    return crypto.randomUUID();
  }

  return `vip-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function CrownIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={styles.svg}
    >
      <path d="m3 7 4 4 5-7 5 7 4-4-2 13H5L3 7Z" />
      <path d="M5 17h14" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={styles.svg}
    >
      <path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z" />
      <path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />
    </svg>
  );
}

function PointsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={styles.svg}
    >
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M9 11h6M9 13h6" />
    </svg>
  );
}

function AiIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={styles.svg}
    >
      <rect x="4" y="5" width="16" height="14" rx="4" />
      <path d="M8 11h.01M16 11h.01" />
      <path d="M9 15c1.8 1.2 4.2 1.2 6 0" />
      <path d="M8 5V3M16 5V3" />
    </svg>
  );
}

function GiftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={styles.svg}
    >
      <rect x="4" y="9" width="16" height="11" rx="2" />
      <path d="M3 9h18v4H3z" />
      <path d="M12 9v11" />
      <path d="M12 9H8.5a2.5 2.5 0 1 1 2.5-2.5V9Z" />
      <path d="M12 9h3.5A2.5 2.5 0 1 0 13 6.5V9Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={styles.checkIcon}
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={styles.arrowIcon}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function getDurationLabel(plan: Plan) {
  if (!plan.durationMonths) {
    return "بدون مدة";
  }

  if (plan.durationMonths === 1) {
    return "شهري";
  }

  if (plan.durationMonths === 12) {
    return "سنوي";
  }

  return `${plan.durationMonths} أشهر`;
}

function getFeatures(plan: Plan) {
  return [
    `مضاعف النقاط ×${plan.pointsMultiplier}`,
    `${plan.chatCredits.toLocaleString("en-US")} رصيد AI Chat`,
    `${plan.imageCredits.toLocaleString("en-US")} رصيد AI Image`,
    `${plan.videoCredits.toLocaleString("en-US")} رصيد AI Video`,
    "مزايا VIP الحصرية",
  ];
}

export default function VipPlansClient() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [plansResponse, statusResponse] =
          await Promise.all([
            fetch("/api/vip/plans", {
              cache: "no-store",
            }),
            fetch("/api/vip/status", {
              cache: "no-store",
            }),
          ]);

        const plansJson = await plansResponse.json();

        if (!plansResponse.ok) {
          throw new Error(
            plansJson?.error ||
              "تعذر تحميل باقات VIP.",
          );
        }

        let nextStatus: Status | null = null;

        if (statusResponse.ok) {
          const statusJson =
            await statusResponse.json();

          nextStatus =
            statusJson?.data ?? null;
        }

        if (!cancelled) {
          setPlans(
            Array.isArray(plansJson?.data)
              ? plansJson.data
              : [],
          );

          setStatus(nextStatus);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "تعذر تحميل نظام VIP.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  const orderedPlans = useMemo(() => {
    const order = [
      "FREE",
      "VIP_1M",
      "VIP_3M",
      "VIP_6M",
      "VIP_1Y",
    ];

    return [...plans].sort(
      (a, b) =>
        order.indexOf(a.code) -
        order.indexOf(b.code),
    );
  }, [plans]);

  async function checkout(planCode: string) {
    setError(null);
    setBusyPlan(planCode);

    try {
      const response = await fetch(
        "/api/vip/checkout",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            planCode,
            idempotencyKey:
              makeIdempotencyKey(),
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          window.location.href =
            "/auth/login?next=/vip";
          return;
        }

        throw new Error(
          data?.error ||
            "تعذر بدء عملية الدفع.",
        );
      }

      if (
        typeof data.checkoutUrl === "string" &&
        data.checkoutUrl.length > 0
      ) {
        window.location.assign(
          data.checkoutUrl,
        );
        return;
      }

      throw new Error(
        "لم يُرجع مزود الدفع رابط دفع صالحًا.",
      );
    } catch (checkoutError) {
      setError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "تعذر بدء الدفع.",
      );
    } finally {
      setBusyPlan(null);
    }
  }

  if (loading) {
    return (
      <main className={styles.page}>
        <section className={styles.loadingCard}>
          <div className={styles.loadingOrb}>
            <CrownIcon />
          </div>

          <h1>GameVortex VIP</h1>

          <p>
            جارٍ تحميل الباقات والمزايا...
          </p>
        </section>
      </main>
    );
  }

  const currentPlan =
    status?.isOwner
      ? "OWNER"
      : status?.isVip
        ? status.planCode
        : "FREE";

  return (
    <main
      className={styles.page}
      dir="rtl"
    >
      <section className={styles.hero}>
        <div className={styles.heroGlowOne} />
        <div className={styles.heroGlowTwo} />

        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <CrownIcon />
            <span>GAMEVORTEX VIP</span>
          </div>

          <h1 className={styles.heroTitle}>
            ارفع مستوى
            <span> تجربتك</span>
          </h1>

          <p className={styles.heroText}>
            احصل على نقاط أكثر، رصيد AI أكبر،
            عروض حصرية، مكافآت خاصة وتجربة
            GameVortex أكثر تميزًا.
          </p>

          <div className={styles.heroActions}>
            <a
              href="#vip-plans"
              className={`${styles.primaryButton} ${styles.largeButton}`}
            >
              <CrownIcon />
              اختر خطتك الآن
            </a>

            <Link
              href="/ai"
              className={`${styles.secondaryButton} ${styles.largeButton}`}
            >
              <AiIcon />
              اكتشف GameVortex AI
            </Link>
          </div>
        </div>

        <div className={styles.heroCrown}>
          <div className={styles.crownRing}>
            <CrownIcon />
          </div>

          <div className={styles.heroCrownTitle}>
            VIP
          </div>

          <div className={styles.heroCrownText}>
            MORE REWARDS
            <br />
            MORE AI
            <br />
            MORE POSSIBILITIES
          </div>
        </div>
      </section>

      <section className={styles.benefits}>
        <div className={styles.benefit}>
          <div className={styles.benefitIcon}>
            <PointsIcon />
          </div>
          <div>
            <strong>نقاط أكثر</strong>
            <span>مضاعف نقاط حسب الباقة</span>
          </div>
        </div>

        <div className={styles.benefit}>
          <div className={styles.benefitIcon}>
            <AiIcon />
          </div>
          <div>
            <strong>AI Credits أكبر</strong>
            <span>Chat و Image و Video</span>
          </div>
        </div>

        <div className={styles.benefit}>
          <div className={styles.benefitIcon}>
            <GiftIcon />
          </div>
          <div>
            <strong>مكافآت حصرية</strong>
            <span>عروض ومكافآت VIP</span>
          </div>
        </div>

        <div className={styles.benefit}>
          <div className={styles.benefitIcon}>
            <SparkIcon />
          </div>
          <div>
            <strong>تجربة مميزة</strong>
            <span>مزايا خاصة لأعضاء VIP</span>
          </div>
        </div>
      </section>

      {error ? (
        <section
          className={styles.errorBox}
          role="alert"
        >
          <strong>حدث خطأ</strong>
          <span>{error}</span>
        </section>
      ) : null}

      {status ? (
        <section className={styles.accountCard}>
          <div className={styles.accountHeader}>
            <div>
              <span className={styles.smallLabel}>
                عضويتك الحالية
              </span>

              <h2>
                {status.isOwner
                  ? "Owner VIP"
                  : status.isVip
                    ? status.planCode
                    : "Free"}
              </h2>
            </div>

            <span
              className={
                status.isOwner
                  ? styles.ownerBadge
                  : status.isVip
                    ? styles.activeBadge
                    : styles.freeBadge
              }
            >
              {status.isOwner
                ? "OWNER"
                : status.isVip
                  ? "VIP ACTIVE"
                  : "FREE"}
            </span>
          </div>

          <div className={styles.accountStats}>
            <div>
              <strong>
                ×{status.pointsMultiplier}
              </strong>
              <span>مضاعف النقاط</span>
            </div>

            <div>
              <strong>
                {status.chatCredits.toLocaleString(
                  "en-US",
                )}
              </strong>
              <span>Chat Credits</span>
            </div>

            <div>
              <strong>
                {status.imageCredits.toLocaleString(
                  "en-US",
                )}
              </strong>
              <span>Image Credits</span>
            </div>

            <div>
              <strong>
                {status.videoCredits.toLocaleString(
                  "en-US",
                )}
              </strong>
              <span>Video Credits</span>
            </div>
          </div>
        </section>
      ) : null}

      <section
        id="vip-plans"
        className={styles.plansSection}
      >
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionKicker}>
              VIP PLANS
            </span>

            <h2>
              اختر الباقة المناسبة لك
            </h2>

            <p>
              كلما ارتفعت الباقة، تحصل على
              رصيد ومزايا أكثر.
            </p>
          </div>
        </div>

        <div className={styles.plansGrid}>
          {orderedPlans.map((plan) => {
            const isCurrent =
              currentPlan === plan.code;

            const disabled =
              isCurrent ||
              Boolean(status?.isVip) ||
              busyPlan === plan.code;

            const accent =
              PLAN_ACCENTS[plan.code] ||
              styles.purple;

            const features =
              getFeatures(plan);

            return (
              <article
                key={plan.code}
                className={`${styles.planCard} ${accent} ${
                  isCurrent
                    ? styles.currentPlan
                    : ""
                }`}
              >
                {plan.code === "VIP_1Y" ? (
                  <div
                    className={
                      styles.popularBadge
                    }
                  >
                    الأكثر قيمة
                  </div>
                ) : null}

                <div className={styles.planTop}>
                  <div
                    className={
                      styles.planIcon
                    }
                  >
                    {plan.emoji}
                  </div>

                  <div>
                    <span
                      className={
                        styles.planLabel
                      }
                    >
                      {PLAN_LABELS[
                        plan.code
                      ] || "VIP"}
                    </span>

                    <h3>
                      {plan.nameAr}
                    </h3>
                  </div>
                </div>

                <p
                  className={
                    styles.planDescription
                  }
                >
                  {PLAN_DESCRIPTIONS[
                    plan.code
                  ] ||
                    "استمتع بمزايا GameVortex VIP."}
                </p>

                <div
                  className={
                    styles.priceBlock
                  }
                >
                  <strong>
                    {plan.priceLabel}
                  </strong>

                  <span>
                    {getDurationLabel(
                      plan,
                    )}
                  </span>
                </div>

                <div
                  className={
                    styles.featureList
                  }
                >
                  {features.map(
                    (feature) => (
                      <div
                        key={feature}
                        className={
                          styles.feature
                        }
                      >
                        <span
                          className={
                            styles.check
                          }
                        >
                          <CheckIcon />
                        </span>

                        <span>
                          {feature}
                        </span>
                      </div>
                    ),
                  )}
                </div>

                <button
                  type="button"
                  className={
                    isCurrent
                      ? styles.currentButton
                      : styles.planButton
                  }
                  disabled={disabled}
                  onClick={() => {
                    if (
                      plan.purchasable &&
                      !disabled
                    ) {
                      void checkout(
                        plan.code,
                      );
                    }
                  }}
                >
                  {busyPlan ===
                  plan.code
                    ? "جارٍ التحويل للدفع..."
                    : isCurrent
                      ? "خطتك الحالية"
                      : plan.purchasable
                        ? "اشترك الآن"
                        : "مجاني"}

                  {!isCurrent &&
                  plan.purchasable ? (
                    <ArrowIcon />
                  ) : null}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.ownerCard}>
        <div className={styles.ownerIcon}>
          <CrownIcon />
        </div>

        <div className={styles.ownerContent}>
          <div className={styles.ownerTitleRow}>
            <span>OWNER VIP</span>
            <small>SPECIAL</small>
          </div>

          <h2>
            عضوية المالك الدائمة
          </h2>

          <p>
            مخصصة لحساب SUPER_ADMIN فقط.
            تشمل جميع مزايا VIP مع الوصول
            إلى صلاحيات المالك والميزات الخاصة.
          </p>

          <div className={styles.ownerFeatures}>
            <span>♾ استخدام AI</span>
            <span>♾ VIP دائم</span>
            <span>👑 جميع المزايا</span>
            <span>⚙️ صلاحيات المالك</span>
          </div>
        </div>

        <div className={styles.ownerAccess}>
          <strong>مجاني</strong>

          <span>
            {status?.isOwner
              ? "تم تفعيل Owner VIP"
              : "مخصص للمالك"}
          </span>
        </div>
      </section>

      <section className={styles.whySection}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionKicker}>
              WHY VIP?
            </span>

            <h2>
              لماذا GameVortex VIP؟
            </h2>
          </div>
        </div>

        <div className={styles.whyGrid}>
          <div className={styles.whyCard}>
            <PointsIcon />
            <h3>اكسب أكثر</h3>
            <p>
              احصل على مضاعف نقاط أعلى
              حسب باقتك.
            </p>
          </div>

          <div className={styles.whyCard}>
            <AiIcon />
            <h3>AI أقوى</h3>
            <p>
              رصيد أكبر لـ Chat وImage
              وVideo.
            </p>
          </div>

          <div className={styles.whyCard}>
            <GiftIcon />
            <h3>مكافآت خاصة</h3>
            <p>
              عروض ومكافآت مخصصة لأعضاء
              VIP.
            </p>
          </div>

          <div className={styles.whyCard}>
            <SparkIcon />
            <h3>تجربة مميزة</h3>
            <p>
              مزايا حصرية داخل GameVortex
              Hub.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
