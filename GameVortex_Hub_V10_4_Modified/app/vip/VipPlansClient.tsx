"use client";

import { useEffect, useMemo, useState } from "react";

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

export default function VipPlansClient() {
  const [plans, setPlans] =
    useState<Plan[]>([]);
  const [status, setStatus] =
    useState<Status | null>(null);
  const [loading, setLoading] =
    useState(true);
  const [busyPlan, setBusyPlan] =
    useState<string | null>(null);
  const [error, setError] =
    useState<string | null>(null);

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

        let nextStatus: Status | null =
          null;

        if (statusResponse.ok) {
          const statusJson =
            await statusResponse.json();

          nextStatus =
            statusJson?.data ?? null;
        }

        if (!cancelled) {
          setPlans(
            Array.isArray(
              plansJson?.data,
            )
              ? plansJson.data
              : [],
          );

          setStatus(
            nextStatus,
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "تعذر تحميل VIP.",
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

  const paidPlans =
    useMemo(
      () =>
        plans.filter(
          (plan) =>
            plan.purchasable,
        ),
      [plans],
    );

  async function checkout(
    planCode: string,
  ) {
    setError(null);
    setBusyPlan(planCode);

    try {
      const response =
        await fetch(
          "/api/vip/checkout",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              planCode,
              idempotencyKey:
                makeIdempotencyKey(),
            }),
          },
        );

      const data =
        await response.json();

      if (!response.ok) {
        if (
          response.status === 401
        ) {
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
      <section className="card">
        <p className="muted">
          جارٍ تحميل نظام VIP...
        </p>
      </section>
    );
  }

  return (
    <>
      {error ? (
        <div
          role="alert"
          className="card"
          style={{
            marginBottom: 20,
            border:
              "1px solid rgba(255,80,80,.35)",
          }}
        >
          {error}
        </div>
      ) : null}

      {status ? (
        <section
          className="stats"
          style={{
            marginBottom: 20,
          }}
        >
          <div className="stat">
            <strong>
              {status.isOwner
                ? "Owner VIP"
                : status.isVip
                  ? status.planCode
                  : "Free"}
            </strong>
            <span className="muted">
              الحالة: {status.status}
            </span>
          </div>

          <div className="stat">
            <strong>
              x{status.pointsMultiplier}
            </strong>
            <span className="muted">
              مضاعف النقاط
            </span>
          </div>

          <div className="stat">
            <strong>
              {status.chatCredits}
            </strong>
            <span className="muted">
              AI Chat
            </span>
          </div>

          <div className="stat">
            <strong>
              {status.imageCredits}
            </strong>
            <span className="muted">
              AI Image
            </span>
          </div>

          <div className="stat">
            <strong>
              {status.videoCredits}
            </strong>
            <span className="muted">
              AI Video
            </span>
          </div>
        </section>
      ) : (
        <section className="card">
          <p className="muted">
            سجّل الدخول لعرض رصيدك ومزايا عضويتك.
          </p>
        </section>
      )}

      <section
        className="grid"
        style={{
          gridTemplateColumns:
            "repeat(auto-fit, minmax(230px, 1fr))",
          gap: 16,
        }}
      >
        {paidPlans.map((plan) => {
          const disabled =
            Boolean(status?.isVip) ||
            busyPlan === plan.code;

          return (
            <article
              key={plan.code}
              className="card"
              style={{
                display: "flex",
                flexDirection:
                  "column",
                gap: 14,
              }}
            >
              <div
                style={{
                  fontSize: 34,
                }}
              >
                {plan.emoji}
              </div>

              <h2
                style={{
                  margin: 0,
                }}
              >
                {plan.nameAr}
              </h2>

              <strong
                style={{
                  fontSize: 28,
                }}
              >
                {plan.priceLabel}
              </strong>

              <div className="muted">
                {plan.durationMonths}{" "}
                {plan.durationMonths === 1
                  ? "شهر"
                  : "أشهر"}
              </div>

              <ul
                style={{
                  margin: 0,
                  paddingInlineStart: 20,
                }}
              >
                <li>
                  مضاعف النقاط x
                  {plan.pointsMultiplier}
                </li>
                <li>
                  {plan.chatCredits} Chat
                </li>
                <li>
                  {plan.imageCredits} Image
                </li>
                <li>
                  {plan.videoCredits} Video
                </li>
              </ul>

              <button
                type="button"
                className="btn"
                disabled={disabled}
                onClick={() =>
                  void checkout(
                    plan.code,
                  )
                }
                style={{
                  marginTop: "auto",
                  opacity:
                    disabled
                      ? 0.6
                      : 1,
                  cursor:
                    disabled
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {busyPlan ===
                plan.code
                  ? "جارٍ إنشاء الدفع..."
                  : status?.isVip
                    ? "VIP مفعّل"
                    : "اشترك الآن"}
              </button>
            </article>
          );
        })}
      </section>
    </>
  );
}
