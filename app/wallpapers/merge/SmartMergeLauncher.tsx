"use client";

import { useState } from "react";

const DB_NAME = "gamevortex-wallpaper-bridge";
const STORE_NAME = "results";
const RESULT_KEY = "latest-merge";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("INDEXED_DB_OPEN_FAILED"));
  });
}

async function saveResult(blob: Blob) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(blob, RESULT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("INDEXED_DB_WRITE_FAILED"));
  });
  db.close();
}

export default function SmartMergeLauncher() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function openInStudio() {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[aria-label='معاينة Wallpaper المدمج']") ?? document.querySelector<HTMLCanvasElement>("canvas");
    if (!canvas) {
      setStatus("لم يتم العثور على نتيجة الدمج. نفّذ الدمج أولًا.");
      return;
    }
    setBusy(true);
    setStatus("جاري تجهيز النتيجة وفتح Wallpaper Studio...");
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 1));
      if (!blob) throw new Error("MERGE_EXPORT_FAILED");
      await saveResult(blob);
      window.location.assign("/wallpapers/studio?from=smart-merge");
    } catch {
      setStatus("تعذر نقل النتيجة إلى الاستوديو. حاول الدمج مرة أخرى.");
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <button className="btn secondary" style={{ width: "100%" }} disabled={busy} onClick={openInStudio}>
        {busy ? "جاري الفتح..." : "فتح النتيجة في Wallpaper Studio"}
      </button>
      {status && <p role="status" className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>{status}</p>}
    </div>
  );
}
