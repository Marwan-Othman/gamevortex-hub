"use client";

import { useState } from "react";

type TradingTestnetResult = {
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
};

function getSafeErrorMessage(error?: string): string {
  switch (error) {
    case "BINANCE_TESTNET_RESTRICTED_LOCATION":
      return "Binance Testnet غير متاح من بيئة الخادم الحالية بسبب قيود الموقع/الأهلية لدى Binance. المفتاح صحيح، ولا نحتاج إلى إنشاء مفتاح جديد.";
    case "BINANCE_TESTNET_API_CREDENTIALS_REQUIRED":
      return "مفاتيح Binance Testnet غير موجودة على الخادم. أضف BINANCE_TESTNET_API_KEY وBINANCE_TESTNET_API_SECRET في Vercel كـ Secret.";
    case "BINANCE_TESTNET_API_AUTH_FAILED":
      return "Binance رفض اعتماد مفتاح Testnet. تحقق أن المفتاح من Spot Testnet وأنه يخص نفس بيئة الاختبار.";
    case "BINANCE_TESTNET_TIMESTAMP_INVALID":
      return "رفض Binance الطلب بسبب مشكلة في الوقت أو recvWindow. أعد المحاولة بعد مزامنة وقت الخادم.";
    case "BINANCE_TESTNET_SIGNATURE_INVALID":
      return "رفض Binance توقيع الطلب. لم يتم تنفيذ أي أمر.";
    case "BINANCE_TESTNET_RATE_LIMITED":
      return "تم تجاوز حد طلبات Binance Testnet. انتظر قليلًا ثم أعد الفحص.";
    case "BINANCE_TESTNET_NETWORK_ERROR":
      return "تعذر الاتصال بـ Binance Testnet. لم يتم تنفيذ أي أمر.";
    case "BINANCE_TESTNET_INVALID_RESPONSE":
      return "أرسل Binance استجابة غير صالحة. لم يتم اعتبار الفحص ناجحًا.";
    case "BINANCE_TESTNET_PROVIDER_ERROR":
      return "رفض Binance طلب Testnet. السبب غير مصنف، ولم يتم السماح بالتنفيذ.";
    case "BINANCE_TESTNET_TRADING_DISABLED":
      return "صلاحية التداول غير مفعّلة على مفتاح Binance Testnet.";
    case "BINANCE_TESTNET_WITHDRAWALS_MUST_BE_DISABLED":
      return "تم رفض الفحص لأن صلاحية السحب يجب أن تبقى معطّلة دائمًا.";
    case "BINANCE_TESTNET_SPOT_PERMISSION_REQUIRED":
      return "صلاحية Spot غير موجودة على مفتاح Binance Testnet.";
    case "FORBIDDEN":
      return "غير مصرح بهذا الفحص.";
    default:
      return error || "Testnet غير جاهز بعد.";
  }
}

export default function TradingTestnetPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TradingTestnetResult | null>(null);

  async function checkStatus() {
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch("/api/admin/trading/exchange/testnet/status", {
        method: "GET",
        cache: "no-store",
      });

      const payload = (await response.json()) as TradingTestnetResult;

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
            <strong>{getSafeErrorMessage(result.error)}</strong>
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
