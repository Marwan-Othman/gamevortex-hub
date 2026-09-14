"use client";

import { useEffect, useState } from "react";

type Report = {
  ownerEmail: string;
  currentOwners: { email: string; username: string | null; isTarget: boolean }[];
  toDemoteCount: number;
};

export default function FixOwnerPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/fix-owner")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "FAILED");
        setReport(data);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function apply() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await fetch("/api/admin/fix-owner", { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "FAILED");
      setResult(`تم ✅ المالك المستعاد: ${data.restoredOwner}\nتم إخفاض: ${data.demoted.join(", ") || "لا أحد"}\n${data.note}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "FAILED");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap" dir="rtl" style={{ maxWidth: 480, margin: "0 auto", padding: 20 }}>
      <h1>إصلاح تعارض المالك</h1>

      {error && <p style={{ color: "red" }}>خطأ: {error}</p>}

      {!report && !error && <p>جارٍ التحميل...</p>}

      {report && (
        <>
          <p>الإيميل المستهدف (OWNER_EMAIL): <strong>{report.ownerEmail}</strong></p>
          <h3>الحسابات اللي عندها SUPER_ADMIN دلوقتي:</h3>
          <ul>
            {report.currentOwners.map((u) => (
              <li key={u.email}>
                {u.email} ({u.username || "بدون اسم مستخدم"}){" "}
                {u.isTarget ? "← المالك المقصود" : "← سيتم إخفاضه"}
              </li>
            ))}
            {!report.currentOwners.length && <li>لا يوجد أي حساب SUPER_ADMIN حاليًا</li>}
          </ul>
          <p>عدد الحسابات التي سيتم إخفاضها: <strong>{report.toDemoteCount}</strong></p>

          {!result && (
            <button className="btn" onClick={apply} disabled={busy}>
              {busy ? "جارٍ التنفيذ..." : "تطبيق الإصلاح الآن"}
            </button>
          )}
        </>
      )}

      {result && <pre style={{ whiteSpace: "pre-wrap", marginTop: 16 }}>{result}</pre>}
    </main>
  );
}
