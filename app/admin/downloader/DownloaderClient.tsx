"use client";

import { useState } from "react";

type Item = {
  id: string;
  label: string;
};

export default function DownloaderClient({
  games,
  apps,
}: {
  games: Item[];
  apps: Item[];
}) {
  const [entityType, setEntityType] = useState<"GAME" | "APP">("GAME");
  const [entityId, setEntityId] = useState(games[0]?.id || apps[0]?.id || "");
  const [sourceUrl, setSourceUrl] = useState("");
  const [filename, setFilename] = useState("");
  const [confirmRights, setConfirmRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const items = entityType === "GAME" ? games : apps;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/admin/downloader/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityType, entityId, sourceUrl, filename, confirmRights }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || payload.error || "فشل الاستيراد");

      setMessage(`تم استيراد الملف بنجاح: ${payload.data.filename}`);
      setSourceUrl("");
      setFilename("");
      setConfirmRights(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "حدث خطأ غير متوقع");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="glass card" style={{ display: "grid", gap: 14 }}>
      <div className="filter-row">
        <select className="input" value={entityType} onChange={(event) => {
          const next = event.target.value as "GAME" | "APP";
          setEntityType(next);
          const nextItems = next === "GAME" ? games : apps;
          setEntityId(nextItems[0]?.id || "");
        }}>
          <option value="GAME">لعبة</option>
          <option value="APP">تطبيق</option>
        </select>

        <select className="input" value={entityId} onChange={(event) => setEntityId(event.target.value)} required>
          {items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>

      <input
        className="input"
        type="url"
        required
        value={sourceUrl}
        onChange={(event) => setSourceUrl(event.target.value)}
        placeholder="رابط الملف المباشر HTTPS/HTTP"
      />

      <input
        className="input"
        value={filename}
        onChange={(event) => setFilename(event.target.value)}
        placeholder="اسم الملف (اختياري، مثال: Game.apk)"
      />

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <input
          type="checkbox"
          checked={confirmRights}
          onChange={(event) => setConfirmRights(event.target.checked)}
          required
        />
        <span>
          أؤكد أن لدي حق تنزيل هذا الملف وإعادة توزيعه على GameVortex.
        </span>
      </label>

      <button className="btn" type="submit" disabled={busy || !entityId}>
        {busy ? "جارٍ استيراد الملف…" : "استيراد الملف إلى GameVortex"}
      </button>

      {message && <p className="muted" role="status">{message}</p>}
    </form>
  );
}
