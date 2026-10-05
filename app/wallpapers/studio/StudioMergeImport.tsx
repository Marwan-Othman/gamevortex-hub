"use client";

import { useEffect } from "react";

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

async function takeResult(): Promise<Blob | null> {
  const db = await openDb();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(RESULT_KEY);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => reject(request.error ?? new Error("INDEXED_DB_READ_FAILED"));
    tx.oncomplete = () => store.delete(RESULT_KEY);
  });
  db.close();
  return blob;
}

export default function StudioMergeImport() {
  useEffect(() => {
    let cancelled = false;

    async function importResult() {
      if (!new URLSearchParams(window.location.search).has("from")) return;
      try {
        const blob = await takeResult();
        if (!blob || cancelled) return;
        const input = document.querySelector<HTMLInputElement>("input[type='file'][accept*='image/png']")
          ?? document.querySelector<HTMLInputElement>("input[type='file']");
        if (!input) return;

        const file = new File([blob], "gamevortex-smart-merge-1080x1920.png", { type: "image/png" });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (error) {
        console.error("GameVortex Smart Merge Studio import failed", error);
      }
    }

    const timer = window.setTimeout(importResult, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return null;
}
