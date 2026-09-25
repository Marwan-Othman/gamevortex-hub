"use client";

import { useState } from "react";

export default function RepairSchemaPage() {
  const [result, setResult] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const r = await fetch("/api/admin/repair-schema", { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "FAILED");
      setResult(`تم ✅ ${data.message} (صفوف موجودة حاليًا: ${data.existingRows})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "FAILED");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap" dir="rtl" style={{ maxWidth: 480, margin: "0 auto", padding: 20 }}>
      <h1>إصلاح جدول SystemError الناقص</h1>
      <p className="muted">
        هذا يُنشئ جدول SystemError في قاعدة البيانات الحقيقية إذا لم يكن موجودًا (آمن للتشغيل أكثر من مرة).
      </p>
      <button className="btn" onClick={run} disabled={busy}>
        {busy ? "جارٍ التنفيذ..." : "تشغيل الإصلاح الآن"}
      </button>
      {error && <p style={{ color: "red", marginTop: 12 }}>خطأ: {error}</p>}
      {result && <pre style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>{result}</pre>}
    </main>
  );
}
