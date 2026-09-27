متع بالميزات الأساسية داخل GameVortex Hub.", en: "Start for free and enjoy the core GameVortex Hub features." },

  VIP_1M:
    { ar: "خطة مناسبة لتجربة مزايا VIP والحصول على نقاط أكثر.", en: "A great way to try VIP benefits and earn more points." },

  VIP_3M:
    { ar: "ثلاثة أشهر من مزايا VIP ومضاعف نقاط أفضل.", en: "Three months of VIP benefits and a better points multiplier." },

  VIP_6M:
    { ar: "خطة طويلة تمنحك رصيدًا أكبر ومضاعف نقاط قوي ومزايا حصرية.", en: "A longer plan with more credits, a stronger points multiplier and exclusive benefits." },

  VIP_1Y:
    { ar: "تجربة VIP الكاملة لمدة سنة مع أعلى مضاعف نقاط ومزايا حصرية.", en: "A full year of VIP with the highest points multiplier and exclusive benefits." },

  OWNER:
    { ar: "عضوية المالك الدائمة مع جميع مزايا VIP وصلاحيات المالك.", en: "Permanent owner membership with VIP benefits and owner permissions." },
};

const PLAN_ACCENTS: Record<string, string> = {
  FREE: styles.free,
  VIP_1M: styles.bronze,
  VIP_3M: styles.blue,
  VIP_6M: styles.gold,
  VIP_1Y: styles.purple,
  OWNER: styles.owner,
};

const PLAN_LABELS: Record<string, { ar: string; en: string }> = {
  FREE: { ar: "البداية", en: "Starter" },
  VIP_1M: { ar: "شهر واحد", en: "1 month" },
  VIP_3M: { ar: "3 أشهر", en: "3 months" },
  VIP_6M: { ar: "6 أشهر", en: "6 months" },
  VIP_1Y: { ar: "سنة كاملة", en: "1 year" },
  OWNER: { ar: "للمالك فقط", en: "Owner only" },
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

function getDurationLabel(plan: Plan, english: boolean) {
  if (!plan.durationMonths) {
    return english ? "No expiry" : "بدون مدة";
  }

  if (plan.durationMonths === 1) {
    return english ? "Monthly" : "شهري";
  }

  if (plan.durationMonths === 12) {
    return english ? "Yearly" : "سنوي";
  }

  return english ? `${plan.durationMonths} months` : `${plan.durationMonths} أشهر`;
}

/**
 * Owner VIP يستخدم قيمة رقمية كبيرة داخليًا لتمثيل
 * الاستخدام غير المحدود. لا نعرض هذه القيمة للمستخدم.
 */

function getFeatures(plan: Plan, english: boolean) {
  return [
    english ? `Points multiplier ×${plan.pointsMultiplier}` : `مضاعف النقاط ×${plan.pointsMultiplier}`,
    english ? "Exclusive VIP benefits" : "مزايا VIP الحصرية",
  ];
}

export default function VipPlansClient() {
  const english = useLocale() === "en";
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

        const plansJson =
          await plansResponse.json();

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

  async function checkout(
    planCode: string,
  ) {
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
        typeof data.checkoutUrl ===
          "string" &&
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
        <section
          className={styles.loadingCard}
        >
          <div
            className={styles.loadingOrb}
          >
            <CrownIcon />
          </div>

          <h1>GameVortex VIP</h1>

          <p>{english ? "Loading plans and benefits…" : "جارٍ تحميل الباقات والمزايا..."}</p>
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
      lang={english ? "en" : "ar"}
      dir={english ? "ltr" : "rtl"}
    >
      <section className={styles.hero}>
        <div
          className={styles.heroGlowOne}
        />
        <div
          className={styles.heroGlowTwo}
        />

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
            {english ? "Earn more points, unlock exclusive benefits and enjoy special rewards across GameVortex." : "احصل على نقاط أكثر ومزايا حصرية، عروض حصرية، مكافآت خاصة وتجربة GameVortex أكثر تميزًا."}
          </p>

          <div
            className={styles.heroActions}
          >
            <a
              href="#vip-plans"
              className={`${styles.primaryButton} ${styles.largeButton}`}
            >
              <CrownIcon />
              {english ? "Choose your plan" : "اختر خطتك الآن"}
            </a>
          </div>
        </div>

        <div className={styles.heroCrown}>
          <div className={styles.crownRing}>
            <CrownIcon />
          </div>

          <div
            className={styles.heroCrownTitle}
          >
            VIP
          </div>

          <div
            className={styles.heroCrownText}
          >
            MORE REWARDS
            <br />
            MORE VIP
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
            <strong>{english ? "More points" : "نقاط أكثر"}</strong>
            <span>
              {english ? "A points multiplier for your plan" : "مضاعف نقاط حسب الباقة"}
            </span>
          </div>
        </div>

        <div className={styles.benefit}>
          <div className={styles.benefitIcon}>
            <GiftIcon />
          </div>

          <div>
            <strong>{english ? "Exclusive rewards" : "مكافآت حصرية"}</strong>
            <span>{english ? "VIP offers and rewards" : "عروض ومكافآت VIP"}</span>
          </div>
        </div>

        <div className={styles.benefit}>
          <div className={styles.benefitIcon}>
            <SparkIcon />
          </div>

          <div>
            <strong>{english ? "A premium experience" : "تجربة مميزة"}</strong>
            <span>
              {english ? "Special perks for VIP members" : "مزايا خاصة لأعضاء VIP"}
            </span>
          </div>
        </div>
      </section>

      {error ? (
        <section
          className={styles.errorBox}
          role="alert"
        >
          <strong>{english ? "Something went wrong" : "حدث خطأ"}</strong>
          <span>{error}</span>
        </section>
      ) : null}

      {status ? (
        <section
          className={styles.accountCard}
        >
          <div
            className={styles.accountHeader}
          >
            <div>
              <span
                className={styles.smallLabel}
              >
                {english ? "Current membership" : "عضويتك الحالية"}
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

          <div
            className={styles.accountStats}
          >
            <div>
              <strong>
                ×{status.pointsMultiplier}
              </strong>

              <span>
                {english ? "Points multiplier" : "مضاعف النقاط"}
              </span>
            </div>
          </div>
        </section>
      ) : null}

      <section
        id="vip-plans"
        className={styles.plansSection}
      >
        <div
          className={styles.sectionHeading}
        >
          <div>
            <span
              className={styles.sectionKicker}
            >
              VIP PLANS
            </span>

            <h2>
              {english ? "Choose the plan that fits you" : "اختر الباقة المناسبة لك"}
            </h2>

            <p>
              {english ? "Higher plans include more credits and benefits." : "كلما ارتفعت الباقة، تحصل على رصيد ومزايا أكثر."}
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

            const features = getFeatures(plan, english);

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

                <div
                  className={styles.planTop}
                >
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
                      {PLAN_LABELS[plan.code]?.[english ? "en" : "ar"] || "VIP"}
                    </span>

                    <h3>
                      {english ? plan.nameEn : plan.nameAr}
                    </h3>
                  </div>
                </div>

                <p
                  className={
                    styles.planDescription
                  }
                >
                  {PLAN_DESCRIPTIONS[plan.code]?.[english ? "en" : "ar"] || (english ? "Enjoy GameVortex VIP benefits." : "استمتع بمزايا GameVortex VIP.")}
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
                    {getDurationLabel(plan, english)}
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
                    ? (english ? "Redirecting to checkout…" : "جارٍ التحويل للدفع...")
                    : isCurrent
                      ? (english ? "Current plan" : "خطتك الحالية")
                      : plan.purchasable
                        ? (english ? "Subscribe now" : "اشترك الآن")
                        : (english ? "Free" : "مجاني")}

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

      {status?.isOwner ? (
        <section className={styles.ownerCard}>
          <div className={styles.ownerIcon}>
            <CrownIcon />
          </div>

          <div
            className={styles.ownerContent}
          >
            <div
              className={styles.ownerTitleRow}
            >
              <span>OWNER VIP</span>
              <small>SPECIAL</small>
            </div>

            <h2>
              {english ? "Permanent owner membership" : "عضوية المالك الدائمة"}
            </h2>

            <p>
              {english ? "For SUPER_ADMIN accounts only. Includes VIP benefits and owner permissions." : "مخصصة لحساب SUPER_ADMIN فقط. تشمل جميع مزايا VIP مع الوصول إلى صلاحيات المالك والميزات الخاصة."}
            </p>

            <div
              className={styles.ownerFeatures}
            >
              <span>{english ? "♾ Lifetime VIP" : "♾ VIP دائم"}</span>
              <span>{english ? "👑 All benefits" : "👑 جميع المزايا"}</span>
              <span>{english ? "⚙️ Owner permissions" : "⚙️ صلاحيات المالك"}</span>
            </div>
          </div>

          <div
            className={styles.ownerAccess}
          >
            <strong>{english ? "Free" : "مجاني"}</strong>

            <span>
              {english ? "Owner VIP is active" : "تم تفعيل Owner VIP"}
            </span>
          </div>
        </section>
      ) : null}

      <section className={styles.whySection}>
        <div
          className={styles.sectionHeading}
        >
          <div>
            <span
              className={styles.sectionKicker}
            >
              WHY VIP?
            </span>

            <h2>
              {english ? "Why GameVortex VIP?" : "لماذا GameVortex VIP؟"}
            </h2>
          </div>
        </div>

        <div className={styles.whyGrid}>
          <div className={styles.whyCard}>
            <PointsIcon />

            <h3>{english ? "Earn more" : "اكسب أكثر"}</h3>

            <p>
              {english ? "Get a higher points multiplier with your plan." : "احصل على مضاعف نقاط أعلى حسب باقتك."}
            </p>
          </div>

          <div className={styles.whyCard}>
            <GiftIcon />

            <h3>{english ? "Special rewards" : "مكافآت خاصة"}</h3>

            <p>
              {english ? "Offers and rewards for VIP members." : "عروض ومكافآت مخصصة لأعضاء VIP."}
            </p>
          </div>

          <div className={styles.whyCard}>
            <SparkIcon />

            <h3>{english ? "A premium experience" : "تجربة مميزة"}</h3>

            <p>
              {english ? "Exclusive benefits inside GameVortex Hub." : "مزايا حصرية داخل GameVortex Hub."}
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
