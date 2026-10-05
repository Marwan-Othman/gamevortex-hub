"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../../app/admin/admin.module.css";

const CONFIRM_PHRASE = "EXECUTE LIVE ORDER";

type Control = {
  emergencyStopped: boolean;
  emergencyReason: string | null;
  circuitBreakerReasons: string[];
  blockReasons: string[];
};

type Prepared = {
  approvalId: string;
  opportunityId: string;
  token: string;
  expiresAt: string;
  fundingMode: "DIRECT" | "WALLET";
  summary: {
    symbol: string;
    amountUsd: number;
    entryPrice: number;
    stopLossPercent: number;
    takeProfitPercent: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    quoteFreeBalanceUsd: number;
  };
};

type LiveOrder = {
  id: string;
  symbol: string;
  amountUsd: string;
  status: string;
  protectionStatus: string;
  settlementStatus: string;
  averageFillPrice: string | null;
  executedQty: string | null;
  realizedPnlUsd: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

const ERROR_TEXT: Record<string, string> = {
  INVALID_LIVE_ORDER_INPUT: "بيانات الصفقة ناقصة.",
  INVALID_LIVE_ORDER_SYMBOL: "الرمز لازم يكون مقابل USDT، مثل BTC/USDT.",
  INVALID_LIVE_ORDER_AMOUNT: "المبلغ لازم يكون 1$ أو أكثر وبخانتين عشريتين كحد أقصى.",
  INVALID_LIVE_ORDER_STOP_LOSS: "Stop Loss لازم يكون بين 0.1% و20%.",
  INVALID_LIVE_ORDER_TAKE_PROFIT: "Take Profit لازم يكون بين 0.2% و50%.",
  LIVE_OWNER_ACK_REQUIRED: "لازم تؤكد الإقرار قبل التجهيز.",
  GAMEVORTEX_LIVE_TRADING_DISABLED: "التداول الحقيقي مغلق: GAMEVORTEX_LIVE_TRADING_ENABLED مش true.",
  LIVE_RISK_CONFIG_REQUIRED: "احفظ إعدادات Risk Manager أولاً.",
  LIVE_MARKET_DATA_UNAVAILABLE: "ما قدرت أجيب بيانات سوق كافية لهذا الرمز.",
  LIVE_WALLET_MODE_REQUIRES_WHOLE_USD: "وضع المحفظة يحتاج مبلغ بدولارات صحيحة.",
  TRADING_ALLOCATION_REQUIRED:
    "ما في تخصيص من المحفظة بنفس المبلغ. إما خصّص من المحفظة، أو فعّل GAMEVORTEX_LIVE_DIRECT_FUNDING=true لاستخدام رصيدك على Binance.",
  BINANCE_LIVE_INSUFFICIENT_BALANCE: "رصيد USDT الحر على Binance أقل من مبلغ الصفقة.",
  BINANCE_LIVE_MIN_NOTIONAL: "المبلغ أقل من الحد الأدنى للصفقة عند Binance لهذا الرمز.",
  BINANCE_LIVE_API_CREDENTIALS_REQUIRED: "مفاتيح Binance الحقيقية غير مضافة.",
  BINANCE_LIVE_NETWORK_ERROR: "تعذر الوصول إلى Binance.",
  BINANCE_LIVE_PROVIDER_ERROR: "Binance رجّعت خطأ. راجع Vercel Logs.",
  BINANCE_LIVE_PREFLIGHT_BLOCKED: "فحص جاهزية Binance غير ناجح. شغّل الفحص أعلاه.",
  TRADING_CONTROL_BLOCKED: "التداول موقوف (إيقاف طارئ أو قاطع دارة). ارفعه من قسم التحكم أعلاه.",
  LIVE_RISK_BLOCKED: "Risk Manager رفض الصفقة.",
  LIVE_SHARIAH_BLOCKED: "فحص Shariah رفض الصفقة. تأكد من سياسة owner-spot-v1.",
  SHARIAH_POLICY_NOT_FOUND: "سياسة Shariah غير موجودة بقاعدة البيانات.",
  LIVE_SLIPPAGE_BLOCKED: "السعر تحرك أكثر من المسموح بين التجهيز والتنفيذ. جهّز صفقة جديدة.",
  LIVE_MARKET_DATA_STALE: "بيانات السوق قديمة. جهّز صفقة جديدة.",
  APPROVAL_EXPIRED: "انتهت مهلة الموافقة. جهّز صفقة جديدة.",
  APPROVAL_ALREADY_CONSUMED: "هذه الموافقة استُهلكت من قبل.",
  INVALID_APPROVAL_TOKEN: "رمز الموافقة غير صحيح.",
  OWNER_APPROVAL_NOT_CONSUMED: "الموافقة ما استُهلكت بعد.",
  CONFIRMATION_REQUIRED: "عبارة التأكيد غير صحيحة.",
  LIVE_ORDER_NOT_FOUND: "الصفقة غير موجودة.",
  LIVE_MONITOR_NO_ACTIVE_ORDER: "ما في أمر فعّال لهذه الصفقة (لم يُرسل أي شيء إلى Binance).",
  LIVE_ORDER_STATE_NOT_EXECUTABLE: "حالة الأمر لا تسمح بالتنفيذ.",
  LIVE_RECONCILIATION_MISMATCH: "تعارض بين النظام وBinance. راجع الأمر يدوياً على Binance قبل أي خطوة.",
  LIVE_PROTECTION_FAILED: "فشلت حماية الصفقة (Stop/Take). راجع حسابك على Binance فوراً.",
  LIVE_ORDER_UNKNOWN: "حالة الأمر غير معروفة. راجع حسابك على Binance فوراً قبل أي محاولة ثانية.",
  FORBIDDEN: "غير مصرح.",
  INTERNAL_ERROR: "خطأ داخلي. راجع Vercel Logs.",
};

const STATUS_TEXT: Record<string, string> = {
  INTENT_CREATED: "لم يُرسل (نية فقط)",
  SUBMITTING: "جاري الإرسال",
  SUBMITTED: "أُرسل",
  PARTIALLY_FILLED: "منفّذ جزئياً",
  FILLED: "منفّذ",
  PROTECTION_PENDING: "بانتظار الحماية",
  PROTECTED: "مفتوح ومحمي",
  PROTECTION_FAILED: "فشلت الحماية",
  CANCELED: "ملغى",
  REJECTED: "مرفوض",
  EXPIRED: "منتهي",
  UNKNOWN: "غير معروف",
  RECONCILIATION_MISMATCH: "تعارض",
  CLOSED: "مغلق",
};

function explain(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "INTERNAL_ERROR";
  const code = text.split(":")[0];
  const tail = text.slice(code.length + 1);
  const base = ERROR_TEXT[code] ?? "تعذّرت العملية.";
  return `${base}${tail ? ` (${tail})` : ""} [${code}]`;
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data };
}

export default function TradingLiveOrderPanel() {
  const [control, setControl] = useState<Control | null>(null);
  const [orders, setOrders] = useState<LiveOrder[]>([]);
  const [symbol, setSymbol] = useState("BTC/USDT");
  const [amount, setAmount] = useState("10");
  const [stopLoss, setStopLoss] = useState("2");
  const [takeProfit, setTakeProfit] = useState("4");
  const [ack, setAck] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [consumed, setConsumed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadControl = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/trading/control", { cache: "no-store" });
      if (response.ok) setControl((await response.json()).control);
    } catch {
      /* the panel stays usable; actions will report errors */
    }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/trading/live/orders", { cache: "no-store" });
      if (response.ok) setOrders((await response.json()).orders);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadControl();
    void loadOrders();
  }, [loadControl, loadOrders]);

  useEffect(() => {
    if (!prepared) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((new Date(prepared.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [prepared]);

  async function controlAction(action: "EMERGENCY_STOP" | "CLEAR_EMERGENCY_STOP" | "RESET_CIRCUIT_BREAKER") {
    if (action === "CLEAR_EMERGENCY_STOP" && !window.confirm("رفع الإيقاف الطارئ يسمح بتجهيز صفقات حقيقية. متأكد؟")) return;
    if (action === "RESET_CIRCUIT_BREAKER" && !window.confirm("تصفير قاطع الدارة. تأكد إنك راجعت سبب الإيقاف على Binance أولاً. متأكد؟")) return;
    setBusy(true);
    setMessage(null);
    try {
      const { ok, data } = await postJson("/api/admin/trading/control", {
        action,
        confirm: action === "EMERGENCY_STOP" ? undefined : true,
      });
      if (!ok) setMessage(explain(data.error));
      else setControl(data.control);
    } finally {
      setBusy(false);
    }
  }

  async function prepare() {
    setBusy(true);
    setMessage(null);
    setPrepared(null);
    setConsumed(false);
    setConfirmText("");
    try {
      const { ok, data } = await postJson("/api/admin/trading/live/prepare", {
        symbol,
        amountUsd: Number(amount),
        stopLossPercent: Number(stopLoss),
        takeProfitPercent: Number(takeProfit),
        ackOwnerSpot: ack,
      });
      if (!ok) {
        setMessage(explain(data.error));
        return;
      }
      setPrepared(data as Prepared);
    } catch {
      setMessage("تعذّر الاتصال بالخدمة.");
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!prepared) return;
    setBusy(true);
    setMessage(null);
    try {
      if (!consumed) {
        const consume = await postJson(`/api/admin/trading/approvals/${encodeURIComponent(prepared.approvalId)}/consume`, {
          opportunityId: prepared.opportunityId,
          token: prepared.token,
        });
        if (!consume.ok) {
          setMessage(explain(consume.data.error));
          return;
        }
        setConsumed(true);
      }

      const run = await postJson("/api/admin/trading/live/execute", {
        approvalId: prepared.approvalId,
        opportunityId: prepared.opportunityId,
        confirm: confirmText,
      });
      if (!run.ok) {
        setMessage(explain(run.data.error));
        await loadControl();
        await loadOrders();
        return;
      }

      const result = run.data.result;
      setMessage(
        `تم. حالة الأمر: ${STATUS_TEXT[result.status] ?? result.status} — الحماية: ${result.protectionStatus}` +
          (result.blockers?.length ? ` — تنبيهات: ${result.blockers.join(", ")}` : ""),
      );
      setPrepared(null);
      setConsumed(false);
      setConfirmText("");
      await loadControl();
      await loadOrders();
    } catch {
      setMessage("تعذّر الاتصال بالخدمة. لا تكرر الضغط قبل ما تراجع حسابك على Binance وقائمة الصفقات أدناه.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshOrder(orderId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const { ok, data } = await postJson("/api/admin/trading/live/orders", { orderId });
      if (!ok) setMessage(explain(data.error));
      await loadOrders();
      await loadControl();
    } finally {
      setBusy(false);
    }
  }

  const blocked = Boolean(control && control.blockReasons.length > 0);
  const phraseOk = confirmText === CONFIRM_PHRASE;
  const canExecute = Boolean(prepared) && secondsLeft > 0 && phraseOk && !busy;

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <span>Live Order</span>
        <span className="muted">⚠️ أموال حقيقية على Binance Spot</span>
      </div>

      <p className="muted" style={{ marginTop: 10 }}>
        صفقة شراء Spot يدوية بموافقتك. بتمر على Shariah وRisk Manager وفحص Binance، وبعد الشراء بيتحط أمر حماية (Stop Loss + Take Profit)
        على Binance نفسها. ما في وعد بالربح، وممكن تخسر المبلغ كله.
      </p>

      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        <strong>
          {control === null
            ? "جاري قراءة حالة التحكم..."
            : blocked
              ? "التداول موقوف"
              : "التداول مسموح (لا إيقاف طارئ ولا قاطع دارة)"}
        </strong>
        {control && blocked ? (
          <span className="muted" dir="ltr" style={{ overflowWrap: "anywhere" }}>
            {control.blockReasons.join(" | ")}
          </span>
        ) : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {control?.emergencyStopped ? (
            <button type="button" className="btn" disabled={busy} onClick={() => controlAction("CLEAR_EMERGENCY_STOP")}>
              رفع الإيقاف الطارئ
            </button>
          ) : (
            <button type="button" className="btn" disabled={busy || !control} onClick={() => controlAction("EMERGENCY_STOP")}>
              إيقاف طارئ الآن
            </button>
          )}
          {control && control.circuitBreakerReasons.length > 0 ? (
            <button type="button" className="btn" disabled={busy} onClick={() => controlAction("RESET_CIRCUIT_BREAKER")}>
              تصفير قاطع الدارة
            </button>
          ) : null}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 16 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>الرمز</span>
          <input dir="ltr" value={symbol} onChange={(event) => setSymbol(event.target.value)} disabled={busy || Boolean(prepared)} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>حجم الصفقة USD</span>
          <input dir="ltr" type="number" min={1} step="any" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={busy || Boolean(prepared)} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>% Stop Loss</span>
          <input dir="ltr" type="number" min={0.1} step="any" value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} disabled={busy || Boolean(prepared)} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>% Take Profit</span>
          <input dir="ltr" type="number" min={0.2} step="any" value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} disabled={busy || Boolean(prepared)} />
        </label>
      </div>

      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 14 }}>
        <input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} disabled={busy || Boolean(prepared)} />
        <span>
          أقرّ أنها عملية شراء Spot حقيقية للأصل بتسليم فوري، بدون رافعة أو اقتراض، وأنني راجعتها بنفسي (مراجعة المالك، مش مراجعة مختص).
        </span>
      </label>

      <div style={{ marginTop: 14 }}>
        <button type="button" className="btn" onClick={prepare} disabled={busy || blocked || !ack || Boolean(prepared)}>
          {busy && !prepared ? "جاري الفحص..." : "تجهيز الصفقة (لا يرسل شيئاً)"}
        </button>
      </div>

      {prepared ? (
        <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
          <strong>الصفقة جاهزة للتأكيد — مهلة {secondsLeft} ثانية</strong>
          <div dir="ltr" style={{ display: "grid", gap: 4, textAlign: "left" }}>
            <span>BUY {prepared.summary.symbol} (market)</span>
            <span>Amount: ${prepared.summary.amountUsd}</span>
            <span>Entry ≈ {prepared.summary.entryPrice}</span>
            <span>
              Stop Loss: {prepared.summary.stopLossPercent}% ≈ {prepared.summary.stopLossPrice.toFixed(4)}
            </span>
            <span>
              Take Profit: {prepared.summary.takeProfitPercent}% ≈ {prepared.summary.takeProfitPrice.toFixed(4)}
            </span>
            <span>USDT free on Binance: {prepared.summary.quoteFreeBalanceUsd}</span>
            <span>Funding: {prepared.fundingMode === "DIRECT" ? "Direct (Binance balance, no wallet)" : "Owner Wallet allocation"}</span>
          </div>

          <label style={{ display: "grid", gap: 6 }}>
            <span>اكتب بالضبط: {CONFIRM_PHRASE}</span>
            <input dir="ltr" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} disabled={busy} autoComplete="off" />
          </label>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={execute} disabled={!canExecute}>
              {busy ? "جاري التنفيذ..." : consumed ? "إعادة محاولة التنفيذ" : "نفّذ الصفقة الحقيقية"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setPrepared(null);
                setConsumed(false);
                setConfirmText("");
              }}
            >
              إلغاء
            </button>
          </div>
          {secondsLeft === 0 ? <span className="muted">انتهت المهلة. ألغِ وجهّز صفقة جديدة.</span> : null}
        </div>
      ) : null}

      {message ? <p style={{ marginTop: 12, overflowWrap: "anywhere" }}>{message}</p> : null}

      <div style={{ marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <strong>آخر الصفقات الحقيقية</strong>
          <button type="button" className="btn" onClick={loadOrders} disabled={busy}>
            تحديث القائمة
          </button>
        </div>
        {orders.length === 0 ? <p className="muted">لا توجد صفقات حقيقية بعد.</p> : null}
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {orders.map((order) => (
            <div key={order.id} style={{ display: "grid", gap: 4, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <span dir="ltr" style={{ textAlign: "left" }}>
                {order.symbol} — ${order.amountUsd} — {new Date(order.createdAt).toLocaleString("ar")}
              </span>
              <span>
                الحالة: {STATUS_TEXT[order.status] ?? order.status} — الحماية: {order.protectionStatus} — التسوية: {order.settlementStatus}
              </span>
              {order.averageFillPrice ? (
                <span dir="ltr" style={{ textAlign: "left" }}>
                  Fill: {order.averageFillPrice} × {order.executedQty ?? "?"}
                </span>
              ) : null}
              {order.realizedPnlUsd !== null ? (
                <span dir="ltr" style={{ textAlign: "left" }}>
                  P/L: {order.realizedPnlUsd}
                </span>
              ) : null}
              {order.lastError ? (
                <span className="muted" dir="ltr" style={{ textAlign: "left", overflowWrap: "anywhere" }}>
                  {order.lastError}
                </span>
              ) : null}
              {["SUBMITTED", "PARTIALLY_FILLED", "PROTECTION_PENDING", "PROTECTED", "CLOSED", "UNKNOWN"].includes(order.status) &&
              order.settlementStatus !== "SETTLED" ? (
                <div>
                  <button type="button" className="btn" disabled={busy} onClick={() => refreshOrder(order.id)}>
                    تحديث حالة هذه الصفقة من Binance
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
