"use client";

import {
  useEffect,
  useState,
} from "react";

type Props = {
  target: "vip" | "orders" | "wallet";
  referenceId: string | null;
  paypalToken: string | null;
};

export default function PaymentReturnClient({
  target,
  referenceId,
  paypalToken,
}: Props) {
  const [message, setMessage] =
    useState(
      "جارٍ تأكيد عملية الدفع...",
    );

  useEffect(() => {
    let cancelled = false;

    async function finish() {
      if (!referenceId) {
        if (!cancelled) {
          window.location.replace(
            target === "vip"
              ? "/vip"
              : target === "wallet"
                ? "/wallet"
                : "/orders",
          );
        }
        return;
      }

      /*
       * Stripe and other providers complete
       * through their webhook.
       *
       * PayPal requires an explicit capture
       * after customer approval.
       */
      if (paypalToken) {
        try {
          const response =
            await fetch(
              "/api/payments/capture",
              {
                method: "POST",
                headers: {
                  "Content-Type":
                    "application/json",
                },
                body:
                  JSON.stringify({
                    referenceId,
                    paymentId:
                      paypalToken,
                  }),
              },
            );

          if (!response.ok) {
            const data =
              await response
                .json()
                .catch(
                  () => null,
                );

            throw new Error(
              data?.error ||
                "تعذر تأكيد دفع PayPal.",
            );
          }

          if (!cancelled) {
            setMessage(
              "تم تأكيد الدفع. جارٍ تحديث حسابك...",
            );
          }
        } catch (error) {
          if (!cancelled) {
            setMessage(
              error instanceof Error
                ? error.message
                : "تعذر تأكيد الدفع.",
            );
          }

          return;
        }
      }

      if (!cancelled) {
        window.setTimeout(
          () => {
            window.location.replace(
              target === "vip"
                ? "/vip?checkout=complete"
                : target === "wallet"
                  ? "/wallet?checkout=complete"
                  : "/orders?checkout=complete",
            );
          },
          1200,
        );
      }
    }

    void finish();

    return () => {
      cancelled = true;
    };
  }, [
    target,
    referenceId,
    paypalToken,
  ]);

  return (
    <main className="gv-payment-state">
      <section className="gv-payment-card">
        <div className="gv-payment-orb" aria-hidden="true">⌛</div>
        <div className="eyebrow">
          PAYMENT
        </div>

        <h1>
          معالجة الدفع
        </h1>

        <p>
          {message}
        </p>
      </section>
    </main>
  );
}
