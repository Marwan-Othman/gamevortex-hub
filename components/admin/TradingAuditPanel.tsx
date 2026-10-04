"use client";

import { useCallback, useEffect, useState } from "react";

export type TradingAuditEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: string;
};

function formatMetadata(metadata: unknown): string {
  if (metadata === null || metadata === undefined) return "—";
  try {
    const value = JSON.stringify(metadata);
    return value.length > 180 ? `${value.slice(0, 177)}...` : value;
  } catch {
    return "[unavailable]";
  }
}

export default function TradingAuditPanel() {
  const [entries, setEntries] = useState<TradingAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/trading/audit?limit=50", {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        entries?: TradingAuditEntry[];
        error?: string;
      };
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.error || "TRADING_AUDIT_LOAD_FAILED");
      }
      setEntries(payload.entries ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "TRADING_AUDIT_LOAD_FAILED");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="ownerCard" style={{ marginTop: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div className="ownerCardName">Trading Audit History</div>
          <p className="muted" style={{ marginBottom: 0 }}>
            سجل append-only لإجراءات التحكم وأحداث Trading الحساسة. لا يعرض أسرار أو بيانات اعتماد.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "جاري التحميل…" : "تحديث السجل"}
        </button>
      </div>

      {error ? (
        <p role="alert" style={{ marginTop: 16 }}>
          تعذر تحميل سجل التداول: {error}
        </p>
      ) : null}

      {!loading && !error && entries.length === 0 ? (
        <p className="muted" style={{ marginTop: 16 }}>
          لا توجد أحداث Trading مسجلة حتى الآن.
        </p>
      ) : null}

      {entries.length > 0 ? (
        <div style={{ overflowX: "auto", marginTop: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "start", padding: 8 }}>الوقت</th>
                <th style={{ textAlign: "start", padding: 8 }}>الإجراء</th>
                <th style={{ textAlign: "start", padding: 8 }}>الكيان</th>
                <th style={{ textAlign: "start", padding: 8 }}>التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                    {new Date(entry.createdAt).toLocaleString("ar", { dateStyle: "short", timeStyle: "medium" })}
                  </td>
                  <td style={{ padding: 8, fontFamily: "monospace" }}>{entry.action}</td>
                  <td style={{ padding: 8 }}>
                    {entry.entityType}
                    <div className="muted" style={{ fontSize: 12 }}>{entry.entityId}</div>
                  </td>
                  <td dir="ltr" style={{ padding: 8, minWidth: 320, maxWidth: 420, wordBreak: "break-word", overflowWrap: "anywhere", fontFamily: "monospace", fontSize: 12, textAlign: "left" }}>
                    {formatMetadata(entry.metadata)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
