"use client";

import { useCallback, useEffect, useState } from "react";
import { NETWORK_ERROR_MESSAGE, readAdminError } from "@/lib/admin-client";

type Health = { status: string; latencyMs: number | null };
type Data = {
  health: { gemini: Health; manus: Health };
  requests: { total: number; completed: number; failed: number };
  fallbackCount: number;
  providerUsage: Array<{ provider: string; requests: number; credits: number }>;
};

const cardStyle = { border: "1px solid #27272a", borderRadius: 14, padding: 18 } as const;

export default function AiAdminMonitor() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/ai/admin/health", { cache: "no-store" });

      if (!response.ok) {
        setError(await readAdminError(response, "تعذر تحميل حالة الذكاء الاصطناعي."));
        return;
      }

      setData(await response.json());
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="wrap" dir="rtl">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1>مراقبة الذكاء الاصطناعي</h1>
          <p style={{ opacity: .65 }}>للمالك فقط: حالة Gemini و Manus. مفاتيح API لا تُعرض أبدًا.</p>
        </div>

        <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
          {loading ? "جارٍ التحديث..." : "تحديث"}
        </button>
      </div>

      {loading && !data ? <p className="muted" role="status">جارٍ تحميل الحالة...</p> : null}

      {error ? <p role="alert" style={{ color: "#ff8fa3", marginTop: 12 }}>{error}</p> : null}

      {data && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, marginTop: 16 }}>
          {([{ name: "Gemini", health: data.health.gemini }, { name: "Manus", health: data.health.manus }]).map(item => (
            <section key={item.name} style={cardStyle}>
              <strong>{item.name}</strong>
              <div style={{ marginTop: 10 }}>{item.health.status}</div>
              {item.health.latencyMs !== null ? <small className="muted">{item.health.latencyMs} ms</small> : null}
            </section>
          ))}
          <section style={cardStyle}><strong>الطلبات (24 ساعة)</strong><div style={{ marginTop: 10 }}>{data.requests.total}</div><small className="muted">ناجحة {data.requests.completed} · فاشلة {data.requests.failed}</small></section>
          <section style={cardStyle}><strong>مرات التحويل للمزوّد البديل</strong><div style={{ marginTop: 10 }}>{data.fallbackCount}</div></section>
        </div>

        <h2 style={{ marginTop: 28 }}>استخدام المزوّدين · 24 ساعة</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {data.providerUsage.map(item => (
            <div key={item.provider} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: 12, borderBottom: "1px solid #27272a" }}>
              <span>{item.provider}</span>
              <span>{item.requests} طلب · {item.credits} GVC</span>
            </div>
          ))}
          {!data.providerUsage.length ? <p className="muted">لا يوجد استخدام مسجّل خلال آخر 24 ساعة.</p> : null}
        </div>
      </>}
    </main>
  );
}
