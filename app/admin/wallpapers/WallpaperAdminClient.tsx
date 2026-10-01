"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { upload } from "@vercel/blob/client";
import {
  WALLPAPER_BULK_UPLOAD_MAX,
  WALLPAPER_MAX_FILE_SIZE,
  isSupportedWallpaperMimeType,
} from "@/lib/wallpaper-constants";

type Wallpaper = {
  id: string;
  titleAr: string;
  titleEn: string;
  thumbnailUrl: string | null;
  type: "MOBILE" | "DESKTOP";
  category: string;
  tags: string[];
  isVip: boolean;
  published: boolean;
  featured: boolean;
  isAnimated?: boolean;
  mimeType?: string | null;
  originalFilename?: string | null;
  fileSizeBytes?: number | string | null;
  width?: number | null;
  height?: number | null;
  viewCount: number;
  downloadCount: number;
  sourceStatus: string;
};

type QueueStatus = "queued" | "uploading" | "saving" | "done" | "failed" | "cancelled";
type QueueItem = {
  id: string;
  file: File;
  previewUrl: string;
  status: QueueStatus;
  progress: number;
  error?: string;
  controller?: AbortController;
  resultId?: string;
};

const CATEGORY_OPTIONS = [
  ["GAMING", "ألعاب"],
  ["ANIME", "أنمي"],
  ["CYBERPUNK", "سايبر"],
  ["CARS", "سيارات"],
  ["NATURE", "طبيعة"],
  ["SPACE", "فضاء"],
  ["FANTASY", "فانتازيا"],
  ["ARABIC", "عربي"],
  ["ISLAMIC", "إسلامي"],
  ["ABSTRACT", "مجرد"],
  ["MINIMAL", "بسيط"],
  ["TECHNOLOGY", "تقنية"],
  ["AI", "ذكاء اصطناعي"],
  ["NEON", "نيون"],
  ["GAMEVORTEX", "GameVortex"],
  ["SPORTS", "رياضة"],
  ["OTHER", "أخرى"],
] as const;

const EMPTY_FORM = {
  isVip: false,
  published: false,
  featured: false,
  category: "GAMING",
  type: "AUTO" as "AUTO" | "MOBILE" | "DESKTOP",
};

function detectType(width: number, height: number): "MOBILE" | "DESKTOP" {
  return height > width ? "MOBILE" : "DESKTOP";
}

function safeFilename(name: string) {
  return name.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 140) || "wallpaper";
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function isSupportedClientFile(file: File) {
  return isSupportedWallpaperMimeType(file.type);
}

export default function WallpaperAdminClient({ initialWallpapers }: { initialWallpapers: Wallpaper[] }) {
  const [wallpapers, setWallpapers] = useState(initialWallpapers);
  const [form, setForm] = useState(EMPTY_FORM);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const runningRef = useRef(false);

  useEffect(() => { queueRef.current = queue; }, [queue]);

  useEffect(() => () => {
    for (const item of queueRef.current) {
      if (item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
    }
  }, []);

  const accept = useMemo(() => ".jpg,.jpeg,.png,.webp,.gif,.apng,.avif,image/jpeg,image/png,image/webp,image/gif,image/apng,image/avif", []);

  const addFiles = useCallback((files: FileList | File[]) => {
    setMessage("");
    const incoming = Array.from(files);
    if (incoming.length === 0) return;

    const existing = new Set(queueRef.current.map((item) => fileKey(item.file)));
    const available = Math.max(0, WALLPAPER_BULK_UPLOAD_MAX - queueRef.current.length);
    const added: QueueItem[] = [];

    for (const file of incoming.slice(0, available)) {
      if (existing.has(fileKey(file))) continue;
      if (!isSupportedClientFile(file)) {
        setMessage(`الصورة ${file.name} ليست بصيغة مدعومة.`);
        continue;
      }
      if (file.size <= 0) {
        setMessage(`الصورة ${file.name} فارغة أو تالفة.`);
        continue;
      }
      if (file.size > WALLPAPER_MAX_FILE_SIZE) {
        setMessage(`الصورة ${file.name} تتجاوز الحد 50MB.`);
        continue;
      }
      existing.add(fileKey(file));
      added.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "queued",
        progress: 0,
      });
    }
    setQueue((current) => [...current, ...added]);
    if (incoming.length > available) setMessage(`الحد الأقصى لطابور الرفع هو ${WALLPAPER_BULK_UPLOAD_MAX} صورة.`);
  }, []);

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) addFiles(event.target.files);
    event.target.value = "";
  }

  function removeQueued(id: string) {
    const item = queueRef.current.find((x) => x.id === id);
    if (!item || item.status === "uploading" || item.status === "saving") return;
    if (item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
    setQueue((current) => current.filter((x) => x.id !== id));
  }

  async function uploadItem(item: QueueItem) {
    const controller = new AbortController();
    setQueue((current) => current.map((x) => x.id === item.id ? { ...x, status: "uploading", progress: 0, controller } : x));
    try {
      const blob = await upload(
        `wallpapers/${Date.now()}-${crypto.randomUUID()}-${safeFilename(item.file.name)}`,
        item.file,
        {
          access: "public",
          handleUploadUrl: "/api/admin/wallpapers/upload",
          multipart: true,
          onUploadProgress(event) {
            setQueue((current) => current.map((x) => x.id === item.id ? { ...x, progress: Math.round(event.percentage) } : x));
          },
        },
      );

      if (controller.signal.aborted) throw new DOMException("Upload cancelled", "AbortError");

      setQueue((current) => current.map((x) => x.id === item.id ? { ...x, status: "saving", progress: 100, controller: undefined } : x));

      const preview = URL.createObjectURL(item.file);
      const dimensions = await new Promise<{ width: number; height: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
        img.onerror = () => resolve({ width: 0, height: 0 });
        img.src = preview;
      });
      URL.revokeObjectURL(preview);

      const type = form.type === "AUTO" ? detectType(dimensions.width, dimensions.height) : form.type;
      const res = await fetch("/api/admin/wallpapers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "BLOB",
          imageUrl: blob.url,
          originalFilename: item.file.name,
          mimeType: item.file.type,
          fileSizeBytes: item.file.size,
          isAnimated: ["image/gif", "image/apng"].includes(item.file.type),
          width: dimensions.width || undefined,
          height: dimensions.height || undefined,
          type,
          category: form.category,
          isVip: form.isVip,
          published: form.published,
          featured: form.featured,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "فشل حفظ الخلفية");
      setWallpapers((current) => [data.data, ...current]);
      setQueue((current) => current.map((x) => x.id === item.id ? { ...x, status: "done", resultId: data.data.id } : x));
      return true;
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      setQueue((current) => current.map((x) => x.id === item.id ? {
        ...x,
        status: cancelled ? "cancelled" : "failed",
        error: cancelled ? "تم الإلغاء" : error instanceof Error ? error.message : "فشل الرفع",
        controller: undefined,
      } : x));
      return false;
    }
  }

  async function startQueue() {
    if (runningRef.current) return;
    const queuedIds = queueRef.current.filter((x) => x.status === "queued" || x.status === "failed").map((x) => x.id);
    if (!queuedIds.length) return;
    runningRef.current = true;
    setRunning(true);
    setMessage("");
    let cursor = 0;
    const worker = async () => {
      while (cursor < queuedIds.length) {
        const id = queuedIds[cursor++];
        const item = queueRef.current.find((x) => x.id === id);
        if (!item || !(item.status === "queued" || item.status === "failed")) continue;
        await uploadItem(item);
      }
    };
    await Promise.all([worker(), worker()]);
    runningRef.current = false;
    setRunning(false);
    setMessage("انتهى طابور الرفع. الصور الناجحة محفوظة، والفاشلة يمكن إعادة محاولتها منفردة.");
  }

  function cancelItem(id: string) {
    const item = queueRef.current.find((x) => x.id === id);
    item?.controller?.abort();
  }

  function retryItem(id: string) {
    setQueue((current) => current.map((x) => x.id === id ? { ...x, status: "queued", progress: 0, error: undefined } : x));
  }

  function clearCompleted() {
    setQueue((current) => current.filter((item) => {
      if (item.status === "done" || item.status === "cancelled") {
        if (item.previewUrl.startsWith("blob:")) URL.revokeObjectURL(item.previewUrl);
        return false;
      }
      return true;
    }));
  }

  async function patchIds(ids: string[], data: Record<string, unknown>) {
    const res = await fetch("/api/admin/wallpapers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids, ...data }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "فشل التحديث الجماعي");
    const updates = Array.isArray(result.data) ? result.data : [result.data];
    const byId = new Map(updates.map((x: Wallpaper) => [x.id, x]));
    setWallpapers((current) => current.map((item) => byId.get(item.id) || item));
  }

  async function bulkAction(data: Record<string, unknown>) {
    if (!selectedIds.length || bulkBusy) return;
    setBulkBusy(true);
    try {
      await patchIds(selectedIds, data);
      setMessage(`تم تحديث ${selectedIds.length} خلفية.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل العملية");
    } finally { setBulkBusy(false); }
  }

  async function deleteSelected() {
    if (!selectedIds.length || bulkBusy) return;
    if (!window.confirm(`حذف ${selectedIds.length} خلفية نهائيًا؟`)) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/admin/wallpapers", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "فشل الحذف");
      const ids = Array.isArray(result.deletedIds) ? result.deletedIds : selectedIds;
      setWallpapers((current) => current.filter((item) => !ids.includes(item.id)));
      setSelectedIds([]);
      setMessage(`تم حذف ${ids.length} خلفية.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل الحذف");
    } finally { setBulkBusy(false); }
  }

  async function downloadZip() {
    if (!selectedIds.length || bulkBusy) return;
    setBulkBusy(true);
    try {
      const response = await fetch("/api/admin/wallpapers/download-zip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "فشل تنزيل ZIP");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "gamevortex-wallpapers.zip";
      a.click();
      URL.revokeObjectURL(url);
      setMessage(`تم تجهيز ZIP لـ ${selectedIds.length} خلفية.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل تنزيل ZIP");
    } finally { setBulkBusy(false); }
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }

  function selectAll() {
    setSelectedIds(wallpapers.map((x) => x.id));
  }

  function clearSelection() { setSelectedIds([]); }

  async function deleteOne(id: string) {
    if (!window.confirm("حذف الخلفية نهائيًا؟")) return;
    await fetch(`/api/admin/wallpapers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    setWallpapers((current) => current.filter((x) => x.id !== id));
    setSelectedIds((current) => current.filter((x) => x !== id));
  }

  async function submitSingle(event: FormEvent) {
    event.preventDefault();
    await startQueue();
  }

  const selectedCount = selectedIds.length;

  return (
    <div style={{ display: "grid", gap: 20, marginTop: 20 }}>
      <section className="glass card">
        <div className="card-top">
          <div>
            <h2>رفع خلفيات</h2>
            <p className="muted">يمكنك تحديد 1 إلى 100 صورة من Android أو الكمبيوتر. كل صورة لها حالة وتقدم وإعادة محاولة مستقلة.</p>
          </div>
          <strong className="badge">{queue.length}/{WALLPAPER_BULK_UPLOAD_MAX}</strong>
        </div>

        <form onSubmit={submitSingle} style={{ display: "grid", gap: 14, marginTop: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
            <label className="glass card" style={{ padding: 12, cursor: "pointer" }}>
              <strong>الصور</strong>
              <input ref={inputRef} type="file" accept={accept} multiple onChange={onPick} disabled={running} style={{ width: "100%", marginTop: 8 }} />
            </label>
            <label className="glass card" style={{ padding: 12 }}>
              <strong>النوع</strong>
              <select className="input" value={form.type} onChange={(e) => setForm((x) => ({ ...x, type: e.target.value as typeof form.type }))}>
                <option value="AUTO">تلقائي</option><option value="MOBILE">Mobile</option><option value="DESKTOP">Desktop</option>
              </select>
            </label>
            <label className="glass card" style={{ padding: 12 }}>
              <strong>التصنيف</strong>
              <select className="input" value={form.category} onChange={(e) => setForm((x) => ({ ...x, category: e.target.value }))}>
                {CATEGORY_OPTIONS.map(([value,label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="glass card" style={{ padding: 12 }}>
              <strong>الوصول</strong>
              <span style={{ display:"flex", gap:10, marginTop:8 }}><label><input type="checkbox" checked={form.isVip} onChange={(e) => setForm((x)=>({...x,isVip:e.target.checked}))}/> VIP</label><label><input type="checkbox" checked={form.published} onChange={(e) => setForm((x)=>({...x,published:e.target.checked}))}/> نشر</label></span>
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn" type="submit" disabled={running || queue.every((x) => x.status !== "queued" && x.status !== "failed")}>⬆️ بدء الرفع</button>
            <button className="btn secondary" type="button" onClick={clearCompleted}>مسح المكتمل</button>
            {message && <span className="muted" role="status">{message}</span>}
          </div>
        </form>

        {queue.length > 0 && <div style={{ display:"grid", gap:10, marginTop:16 }}>
          {queue.map((item) => <div className="glass card" key={item.id} style={{ padding:10, display:"grid", gridTemplateColumns:"88px 1fr auto", gap:12, alignItems:"center" }}>
            <img src={item.previewUrl} alt={item.file.name} style={{ width:88,height:70,objectFit:"cover",borderRadius:12 }} />
            <div>
              <strong style={{ display:"block", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.file.name}</strong>
              <span className="muted">{(item.file.size / 1024 / 1024).toFixed(2)} MB · {item.status}</span>
              <div style={{ height:8, background:"rgba(255,255,255,.08)", borderRadius:99, marginTop:8, overflow:"hidden" }}><div style={{ width:`${item.progress}%`, height:"100%", background:"linear-gradient(90deg,#7c3aed,#38bdf8)" }} /></div>
              {item.error && <small style={{ color:"#ff9b9b" }}>{item.error}</small>}
            </div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap", justifyContent:"flex-end" }}>
              {(item.status === "uploading" || item.status === "saving") && <button className="btn secondary" type="button" onClick={() => cancelItem(item.id)}>إلغاء</button>}
              {item.status === "failed" && <button className="btn secondary" type="button" onClick={() => retryItem(item.id)}>إعادة</button>}
              {(item.status === "queued" || item.status === "failed" || item.status === "cancelled") && <button className="btn secondary" type="button" onClick={() => removeQueued(item.id)}>حذف من الطابور</button>}
            </div>
          </div>)}
        </div>}
      </section>

      <section className="glass card">
        <div className="card-top" style={{ flexWrap:"wrap", gap:10 }}>
          <h2>مكتبة الخلفيات ({wallpapers.length})</h2>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <button className="btn secondary" type="button" onClick={selectAll}>تحديد الكل</button>
            <button className="btn secondary" type="button" onClick={clearSelection}>إلغاء التحديد</button>
            <button className="btn secondary" type="button" disabled={!selectedCount || bulkBusy} onClick={() => bulkAction({ isVip: true })}>VIP</button>
            <button className="btn secondary" type="button" disabled={!selectedCount || bulkBusy} onClick={() => bulkAction({ isVip: false })}>FREE</button>
            <button className="btn secondary" type="button" disabled={!selectedCount || bulkBusy} onClick={() => bulkAction({ published: true })}>نشر</button>
            <button className="btn secondary" type="button" disabled={!selectedCount || bulkBusy} onClick={() => bulkAction({ published: false })}>إخفاء</button>
            <button className="btn secondary" type="button" disabled={!selectedCount || bulkBusy} onClick={downloadZip}>ZIP</button>
            <button className="btn secondary" type="button" disabled={!selectedCount || bulkBusy} onClick={deleteSelected}>حذف</button>
          </div>
        </div>

        <p className="muted">{selectedCount} محددة. يمكنك تغيير الوصول والتصنيف والنوع من أدوات الإدارة.</p>

        <div className="grid" style={{ marginTop:16 }}>
          {wallpapers.map((item) => {
            const selected = selectedIds.includes(item.id);
            return <article key={item.id} className="glass card game-card" style={{ overflow:"hidden", padding:0 }}>
              <div style={{ position:"relative" }}>
                <img src={`/api/wallpapers/${item.id}/media`} alt={item.titleEn} loading="lazy" style={{ width:"100%", aspectRatio:item.width&&item.height?`${item.width}/${item.height}`:"16/9", objectFit:"cover" }} />
                <label style={{ position:"absolute", top:10, left:10, background:"rgba(0,0,0,.55)", padding:"6px 9px", borderRadius:10 }}><input type="checkbox" checked={selected} onChange={() => toggleSelected(item.id)} aria-label={`تحديد ${item.titleEn}`} /></label>
              </div>
              <div style={{ padding:12, display:"grid", gap:8 }}>
                <strong>{item.titleAr || item.titleEn}</strong>
                <div className="muted">{item.type} · {item.category} · {item.isVip ? "VIP" : "FREE"} {item.published ? "· منشور" : "· مخفي"}</div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  <button className="btn secondary" type="button" onClick={() => bulkAction({ ids:[item.id], isVip:!item.isVip })}>تبديل VIP</button>
                  <button className="btn secondary" type="button" onClick={() => deleteOne(item.id)}>حذف</button>
                </div>
              </div>
            </article>;
          })}
        </div>
      </section>
    </div>
  );
}
