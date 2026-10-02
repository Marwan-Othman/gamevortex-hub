"use client";

import { useState } from "react";

export default function TradingTestnetPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    readyForTestnetOrder?: boolean;
    account?: {
      canTrade: boolean;
      canWithdraw: boolean;
      canDeposit: boolean;
      accountType: string;
      permissions: string[];
    };
    error?: string;
  } | null>(null);

  async function checkStatus() {
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch("/api/admin/trading/exchange/testnet/status", {
        method: "GET",
        cache: "no-store",
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        readyForTestnetOrder?: boolean;
        account?: {
          canTrade: boolean;
          canWithdraw: boolean;
          canDeposit: boolean;
          accountType: string;
          permissions: string[];
        };
        error?: string;
      };

      setResult({
        ok: response.ok && payload.ok === true,
        readyForTestnetOrder: payload.readyForTestnetOrder,
        account: payload.account,
        error: payload.error,
      });
    } catch {
      setResult({ ok: false, error: "تعذر الاتصال بخدمة فحص Binance Testnet." });
    } finally {
      setLoading(false);
    }
  }

  const account = result?.account;

  return (
    <section className="ownerCard">
      <div className="ownerCardName">Binance Spot Testnet</div>
      <p className="muted">
        فحص اتصال بيئة الاختبار فقط. لا يرسل أموالًا حقيقية ولا يسمح بالسحب.
        مفاتيح API تبقى على الخادم ولا تظهر في المتصفح.
      </p>

      <button type="button" className="primaryButton" onClick={checkStatus} disabled={loading}>
        {loading ? "جارٍ الفحص..." : "فحص Binance Testnet"}
      </button>

      {result && (
        <div className="muted" style={{ marginTop: 16 }}>
          {result.ok && result.readyForTestnetOrder ? (
            <strong>جاهز لاختبار أمر Testnet.</strong>
          ) : (
            <strong>{result.error || "Testnet غير جاهز بعد."}</strong>
          )}

          {account && (
            <div style={{ marginTop: 10 }}>
              <div>Spot Trading: {account.canTrade ? "مفعّل" : "غير مفعّل"}</div>
              <div>Withdraw: {account.canWithdraw ? "مفعّل — مرفوض" : "معطّل"}</div>
              <div>Deposit: {account.canDeposit ? "مفعّل" : "غير مفعّل"}</div>
              <div>Account: {account.accountType}</div>
              <div>Permissions: {account.permissions.join(", ") || "لا توجد"}</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
