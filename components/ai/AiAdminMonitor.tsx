"use client";

import { useEffect, useState } from "react";

type Health = { status: string; latencyMs: number | null };
type Data = {
  health: { gemini: Health; manus: Health };
  requests: { total: number; completed: number; failed: number };
  fallbackCount: number;
  providerUsage: Array<{ provider: string; requests: number; credits: number }>;
};

export default function AiAdminMonitor() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/ai/admin/health", { cache: "no-store" });
    if (!response.ok) { setError("تعذر تحميل حالة AI."); return; }
    setData(await response.json());
  }

  useEffect(() => { void load(); }, []);

  return (
    <main style={{ minHeight: "100vh", padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <h1>AI Monitoring</h1>
        <p style={{ opacity: .65 }}>Owner-only monitoring for Gemini + Manus. API keys are never displayed.</p>
        {error && <p>{error}</p>}
        {data && <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            {([{ name: "Gemini", health: data.health.gemini }, { name: "Manus", health: data.health.manus }]).map(item => <section key={item.name} style={{ border: "1px solid #27272a", borderRadius: 14, padding: 18 }}><strong>{item.name}</strong><div style={{ marginTop: 10 }}>{item.health.status}</div></section>)}
            <section style={{ border: "1px solid #27272a", borderRadius: 14, padding: 18 }}><strong>Requests</strong><div style={{ marginTop: 10 }}>{data.requests.total}</div></section>
            <section style={{ border: "1px solid #27272a", borderRadius: 14, padding: 18 }}><strong>Fallbacks</strong><div style={{ marginTop: 10 }}>{data.fallbackCount}</div></section>
          </div>
          <h2 style={{ marginTop: 28 }}>Provider Usage · 24h</h2>
          <div style={{ display: "grid", gap: 8 }}>{data.providerUsage.map(item => <div key={item.provider} style={{ display: "flex", justifyContent: "space-between", padding: 12, borderBottom: "1px solid #27272a" }}><span>{item.provider}</span><span>{item.requests} requests · {item.credits} GVC</span></div>)}</div>
        </>}
      </div>
    </main>
  );
}
