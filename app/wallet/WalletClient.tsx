"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const ERRORS: Record<string, string> = {
  UNAUTHORIZED: "سجّل الدخول لعرض محفظتك.",
  WALLET_LOAD_FAILED: "تعذّر تحميل المحفظة. حاول مجددًا بعد قليل.",
  DEPOSIT_FAILED: "تعذّر إنشاء طلب الإضافة. لم يتم خصم أي مبلغ.",
  RATE_LIMITED: "محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.",
  NETWORK: "تعذّر الاتصال بالخادم. تحقق من الإنترنت وأعد المحاولة.",
};

function friendly(code: unknown) {
  const key = typeof code === "string" ? code : "";
  return ERRORS[key] || (key && /[\u0600-\u06FF]/.test(key) ? key : "حدث خطأ غير متوقع. حاول مجددًا.");
}

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

type Wallet = { balance: string | number; pendingBalance: string | number } | null;
type Tx = { id: string; type: string; amount: string | number; balanceAfter: string | number; currency: string; referenceType?: string | null; referenceId?: string | null; createdAt: string };

function money(value: string | number | null | undefined) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function transactionLabel(tx: Tx) {
  if (tx.type === "DEPOSIT") return "إيداع أموال";
  if (tx.type === "WITHDRAWAL") return "سحب أموال";
  if (tx.type === "PURCHASE") return "شراء من المتجر";
  if (tx.type === "REFUND") return "استرداد";
  if (tx.type === "ADJUSTMENT" && tx.referenceType === "TRADING_FUNDING") {
    return "تحويل إلى رصيد المالك للتداول الداخلي";
  }
  if (tx.type === "ADJUSTMENT") return "تعديل رصيد";
  return tx.type;
}

export default function WalletClient() {
  const [wallet, setWallet] = useState<Wallet>(null);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [amount, setAmount] = useState("5");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [checkoutStatus, setCheckoutStatus] = useState<"checking" | "confirmed" | "pending" | null>(null);

  async function load(): Promise<{ wallet: Wallet; transactions: Tx[] } | null> {
    try {
      const response = await fetch("/api/wallet/transactions", { cache: "no-store" });
      const data = await readJson(response);
      if (response.ok && data) {
        const nextTransactions = Array.isArray(data.transactions) ? data.transactions as Tx[] : [];
        setWallet(data.wallet);
        setTransactions(nextTransactions);
        setNeedsLogin(false);
        return { wallet: data.wallet, transactions: nextTransactions };
      } else if (response.status === 401) {
        setNeedsLogin(true);
        setMessage(friendly("UNAUTHORIZED"));
      } else {
        setMessage(friendly(data?.error || "WALLET_LOAD_FAILED"));
      }
    } catch {
      setMessage(friendly("NETWORK"));
    } finally {
      setReady(true);
    }
    return null;
  }

  useEffect(() => {
    let cancelled = false;
    void load();

    const params = new URLSearchParams(window.location.search);
    const depositReference = params.get("reference");
    if (params.get("checkout") !== "complete" || !depositReference) {
      return () => { cancelled = true; };
    }

    setCheckoutStatus("checking");
    let attempts = 0;
    let timer: number | undefined;
    const poll = async () => {
      attempts += 1;
      const data = await load();
      if (cancelled) return;
      const settled = data?.transactions.some((tx) => tx.referenceId === depositReference && tx.type === "DEPOSIT");
      if (settled) {
        setCheckoutStatus("confirmed");
        if (timer !== undefined) window.clearInterval(timer);
      } else if (attempts >= 12) {
        setCheckoutStatus("pending");
        if (timer !== undefined) window.clearInterval(timer);
      }
    };
    timer = window.setInterval(() => { void poll(); }, 5000);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, []);

  async function deposit() {
    if (loading) return;
    const cents = Math.round(Number(amount) * 100);
    if (!Number.isInteger(cents) || cents < 100) {
      setMessage("الحد الأدنى للإضافة هو $1.00");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch("/api/wallet/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountCents: cents,
        }),
      });
      const data = await readJson(response);
      if (response.status === 401) {
        setNeedsLogin(true);
        throw new Error("UNAUTHORIZED");
      }
      if (!response.ok || !data) throw new Error(data?.error || "DEPOSIT_FAILED");
      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return;
      }
      setMessage("تم إنشاء طلب الإضافة، بانتظار مزود الدفع.");
      await load();
    } catch (error) {
      setMessage(friendly(error instanceof Error ? error.message : "DEPOSIT_FAILED"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <p className="muted">MONEY WALLET</p>
        <h1>المحفظة المالية</h1>
        <p>رصيد الأموال منفصل عن نقاط GameVortex. يُضاف الرصيد من الخادم فقط بعد التحقق من اكتمال الدفع لدى مزود الدفع، مع استخدام Webhook للتحديثات والاستردادات.</p>
        {checkoutStatus === "checking" && <p role="status" className="muted">تم الرجوع من الدفع؛ يجري التحقق من وصول الإيداع وتحديث الرصيد تلقائيًا.</p>}
        {checkoutStatus === "confirmed" && <p role="status" className="muted">تم تأكيد الإيداع وظهر في سجل المحفظة.</p>}
        {checkoutStatus === "pending" && <p role="status" className="muted">لم يصل تأكيد الإيداع بعد. لا تُعد الدفع؛ افحص الرصيد المعلّق وسجل المعاملات ثم تواصل مع الدعم إذا استمرت الحالة.</p>}
      </section>

      <section className="grid gv-wallet-grid">
        <article className="glass card gv-wallet-balance">
          <span className="badge">الرصيد الحالي</span>
          <h2 className="gv-wallet-amount" aria-busy={!ready}>{ready && wallet ? `$${money(wallet.balance)} USD` : "—"}</h2>
          <p className="muted">المعلّق: {ready && wallet ? `$${money(wallet.pendingBalance)} USD` : "—"}</p>
        </article>

        <article className="glass card">
          <span className="badge">إضافة أموال</span>
          <h2>تعبئة المحفظة بالفيزا</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            ادفع بأمان باستخدام بطاقة Visa أو بطاقة دفع مدعومة. سيتم فتح صفحة الدفع الآمنة لدى مزود الدفع، ولن تمر بيانات البطاقة عبر خادم GameVortex.
          </p>
          <div className="gv-wallet-actions gv-wallet-amounts">
            {[1, 5, 10, 50, 100].map((value) => <button key={value} className="btn" type="button" onClick={() => setAmount(String(value))}>${value}</button>)}
          </div>
          <input className="input" style={{ marginTop: 12 }} type="number" inputMode="decimal" min="1" max="10000" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="مبلغ تعبئة المحفظة بالدولار" />
          <button className="btn" style={{ marginTop: 10 }} type="button" disabled={loading || needsLogin} onClick={() => void deposit()}>
            {loading ? "جارٍ فتح الدفع الآمن..." : "الدفع بالفيزا وإضافة الأموال"}
          </button>
          <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
            الحد الأدنى $1.00. لا نطلب رقم البطاقة أو CVV داخل GameVortex.
          </p>
          {message && <p className="muted" role="alert" style={{ marginTop: 10, overflowWrap: "anywhere" }}>{message}</p>}
          {needsLogin && <Link className="btn" style={{ marginTop: 10 }} href="/auth/login?next=/wallet">تسجيل الدخول</Link>}
        </article>
      </section>

      <section className="glass card" style={{ marginTop: 18 }}>
        <h2>سجل المحفظة</h2>
        <p className="muted">تحويل «التداول الداخلي» ينقل الرصيد بين دفاتر GameVortex فقط؛ لا يعني تحويل الأموال إلى Binance أو Bybit.</p>
        {!ready ? <p className="muted">جارٍ التحميل…</p> : !transactions.length ? <p className="muted">لا توجد معاملات مالية بعد.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table className="gv-wallet-table">
              <thead><tr><th style={{ textAlign: "right", padding: 10 }}>النوع</th><th style={{ textAlign: "right", padding: 10 }}>المبلغ</th><th style={{ textAlign: "right", padding: 10 }}>الرصيد بعد</th><th style={{ textAlign: "right", padding: 10 }}>التاريخ</th></tr></thead>
              <tbody>{transactions.map((tx) => <tr key={tx.id}><td style={{ padding: 10 }}>{transactionLabel(tx)}</td><td style={{ padding: 10 }}>{Number(tx.amount) >= 0 ? "+" : ""}{money(tx.amount)} {tx.currency}</td><td style={{ padding: 10 }}>{money(tx.balanceAfter)} {tx.currency}</td><td style={{ padding: 10 }}>{new Date(tx.createdAt).toLocaleString("ar")}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
