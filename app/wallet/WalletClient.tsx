"use client";

import { useEffect, useState } from "react";

type Wallet = { balance: string | number; pendingBalance: string | number } | null;
type Tx = { id: string; type: string; amount: string | number; balanceAfter: string | number; currency: string; createdAt: string };

function money(value: string | number | null | undefined) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

export default function WalletClient() {
  const [wallet, setWallet] = useState<Wallet>(null);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [amount, setAmount] = useState("5");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/wallet/transactions", { cache: "no-store" });
    const data = await response.json();
    if (response.ok) {
      setWallet(data.wallet);
      setTransactions(Array.isArray(data.transactions) ? data.transactions : []);
    } else {
      setMessage(data?.error || "WALLET_LOAD_FAILED");
    }
  }

  useEffect(() => { void load(); }, []);

  async function deposit() {
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
          currency: "USD",
          returnUrl: `${window.location.origin}/payment/return?target=wallet&reference=__DEPOSIT_ID__`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "DEPOSIT_FAILED");
      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return;
      }
      setMessage("تم إنشاء طلب الإضافة، بانتظار مزود الدفع.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "DEPOSIT_FAILED");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <p className="muted">MONEY WALLET</p>
        <h1>المحفظة المالية</h1>
        <p>رصيد الأموال منفصل عن نقاط GameVortex. لا يتم زيادة الرصيد من المتصفح، بل بعد تأكيد Webhook من مزود الدفع.</p>
      </section>

      <section className="grid gv-wallet-grid">
        <article className="glass card gv-wallet-balance">
          <span className="badge">الرصيد الحالي</span>
          <h2 className="gv-wallet-amount">${money(wallet?.balance)} USD</h2>
          <p className="muted">المعلّق: ${money(wallet?.pendingBalance)} USD</p>
        </article>

        <article className="glass card">
          <span className="badge">إضافة أموال</span>
          <h2>أضف إلى المحفظة</h2>
          <div className="gv-wallet-actions gv-wallet-amounts">
            {[1, 5, 10, 50, 100].map((value) => <button key={value} className="btn" type="button" onClick={() => setAmount(String(value))}>${value}</button>)}
          </div>
          <input className="input" style={{ marginTop: 12 }} type="number" min="1" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
          <button className="btn" style={{ marginTop: 10 }} type="button" disabled={loading} onClick={() => void deposit()}>{loading ? "جارٍ إنشاء الدفع..." : "إضافة الأموال"}</button>
          {message && <p className="muted" style={{ marginTop: 10, overflowWrap: "anywhere" }}>{message}</p>}
        </article>
      </section>

      <section className="glass card" style={{ marginTop: 18 }}>
        <h2>سجل المحفظة</h2>
        {!transactions.length ? <p className="muted">لا توجد معاملات مالية بعد.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table className="gv-wallet-table">
              <thead><tr><th style={{ textAlign: "right", padding: 10 }}>النوع</th><th style={{ textAlign: "right", padding: 10 }}>المبلغ</th><th style={{ textAlign: "right", padding: 10 }}>الرصيد بعد</th><th style={{ textAlign: "right", padding: 10 }}>التاريخ</th></tr></thead>
              <tbody>{transactions.map((tx) => <tr key={tx.id}><td style={{ padding: 10 }}>{tx.type}</td><td style={{ padding: 10 }}>{Number(tx.amount) >= 0 ? "+" : ""}{money(tx.amount)} {tx.currency}</td><td style={{ padding: 10 }}>{money(tx.balanceAfter)} {tx.currency}</td><td style={{ padding: 10 }}>{new Date(tx.createdAt).toLocaleString("ar")}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
