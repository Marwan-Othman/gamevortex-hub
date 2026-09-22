"use client";

import { useState } from "react";

export default function RepairFazerCardsSchemaPage() {
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const response = await fetch("/api/admin/repair-fazercards-schema", { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "FAILED");
      setResult(
        `تم ✅ الأعمدة الموجودة الآن: ${(data.columns as string[]).join(", ")} (عدد المنتجات: ${data.products})`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "FAILED");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap" dir="rtl" style={{ maxWidth: 480, margin: "0 auto", padding: 20 }}>
      <h1>إصلاح أعمدة FazerCards</h1>
      <p className="muted">
        يضيف عمودي fazerCategoryId وfazerCardId إلى جدول GameProduct إن كانا ناقصين. آمن للتشغيل أكثر من مرة.
      </p>
      <button className="btn" onClick={run} disabled={busy}>
        {busy ? "جارٍ التنفيذ..." : "تشغيل الإصلاح الآن"}
      </button>
      {error && <p style={{ color: "red", marginTop: 12 }}>خطأ: {error}</p>}
      {result && <pre style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>{result}</pre>}
    </main>
  );
}
