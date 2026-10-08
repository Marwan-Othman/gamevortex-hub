"use client";

import { upload } from "@vercel/blob/client";
import { useState } from "react";

const GAME_EXTENSIONS = [".apk", ".aab", ".exe", ".msi", ".zip", ".7z", ".rar", ".iso", ".img", ".dmg", ".pkg", ".appimage", ".deb", ".tar", ".gz", ".tgz", ".obb"];
const PLATFORMS = [["PC", "PC"], ["ANDROID", "Android"], ["IOS", "iPhone / iPad"], ["PLAYSTATION", "PlayStation"], ["XBOX", "Xbox"], ["NINTENDO", "Nintendo"], ["MAC", "macOS"], ["LINUX", "Linux"], ["STEAM_DECK", "Steam Deck"], ["WEB", "Web"]] as const;
const MAX_FILES = 100;
const CONCURRENCY = 3;

type Category = { id: string; nameAr: string; nameEn: string };
type Props = { categories: Category[] };
type Item = { id: string; file: File; titleAr: string; titleEn: string; slug: string; platform: string; progress: number; status: "pending" | "uploading" | "uploaded" | "error"; error?: string };

function slugify(value: string) {
  return value.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 90);
}
function extension(name: string) {
  const lower = name.toLowerCase();
  return GAME_EXTENSIONS.find((item) => lower.endsWith(item)) || "";
}
function titleFromFile(name: string) {
  const ext = extension(name);
  const raw = ext ? name.slice(0, -ext.length) : name;
  return raw.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim() || "Game";
}
function platformFromFile(name: string) {
  const ext = extension(name);
  if (ext === ".apk" || ext === ".aab" || ext === ".obb") return "ANDROID";
  if (ext === ".dmg" || ext === ".pkg") return "MAC";
  if (ext === ".deb" || ext === ".appimage") return "LINUX";
  return "PC";
}
function bytes(value: number) {
  if (value < 1024) return value + " B";
  const units = ["KB", "MB", "GB", "TB"];
  let size = value;
  let index = -1;
  do { size /= 1024; index += 1; } while (size >= 1024 && index < units.length - 1);
  return size.toFixed(size >= 10 ? 0 : 1) + " " + units[index];
}

export default function BulkGameUploadForm({ categories }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [price, setPrice] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [published, setPublished] = useState(true);
  const [rights, setRights] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function update(id: string, patch: Partial<Item>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    setError(null);
    setStatus(null);
    if (!files.length) return;
    if (files.length > MAX_FILES) {
      setError("يمكن تحديد " + MAX_FILES + " لعبة كحد أقصى في الدفعة الواحدة.");
      event.target.value = "";
      return;
    }
    const seen = new Set<string>();
    const next: Item[] = [];
    for (const file of files) {
      if (!extension(file.name)) {
        setError("صيغة غير مدعومة: " + file.name);
        event.target.value = "";
        return;
      }
      const base = slugify(titleFromFile(file.name)) || "game-" + (next.length + 1);
      let slug = base;
      let suffix = 2;
      while (seen.has(slug)) { slug = base + "-" + suffix; suffix += 1; }
      seen.add(slug);
      const title = titleFromFile(file.name);
      next.push({ id: crypto.randomUUID(), file, titleAr: title, titleEn: title, slug, platform: platformFromFile(file.name), progress: 0, status: "pending" });
    }
    setItems(next);
    setProgress(0);
    setStatus("تم تحديد " + next.length + " لعبة. راجع الأسماء والمنصات ثم اضغط رفع الكل.");
  }

  async function cleanup(urls: string[]) {
    const unique = Array.from(new Set(urls.filter(Boolean)));
    if (!unique.length) return;
    try {
      await fetch("/api/admin/games/upload", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls: unique }) });
    } catch {}
  }

  async function uploadOne(item: Item, progressMap: Map<string, number>) {
    update(item.id, { status: "uploading", progress: 0, error: undefined });
    const safe = item.file.name.normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-160);
    const pathname = "games/files/" + Date.now() + "-" + crypto.randomUUID() + "-" + safe;
    const blob = await upload(pathname, item.file, {
      access: "public",
      handleUploadUrl: "/api/admin/games/upload",
      multipart: true,
      clientPayload: JSON.stringify({ kind: "game", mimeType: item.file.type || "application/octet-stream", size: item.file.size }),
      onUploadProgress(event) {
        const value = Math.max(0, Math.min(100, Math.round(event.percentage)));
        progressMap.set(item.id, value);
        update(item.id, { progress: value });
        setItems((current) => {
          const total = current.reduce((sum, row) => sum + row.file.size, 0);
          const done = total ? current.reduce((sum, row) => sum + row.file.size * (progressMap.get(row.id) || row.progress) / 100, 0) / total * 100 : 0;
          setProgress(Math.max(0, Math.min(100, Math.round(done))));
          return current;
        });
      },
    });
    return blob.downloadUrl || blob.url;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus(null);
    if (!items.length) return setError("حدد ملفات الألعاب أولاً.");
    if (!rights) return setError("يجب تأكيد أن لديك حق توزيع ملفات الألعاب.");
    const seen = new Set<string>();
    for (const item of items) {
      const slug = slugify(item.slug);
      if (!item.titleAr.trim() || !item.titleEn.trim() || !slug || !item.platform) return setError("راجع بيانات: " + item.file.name);
      if (seen.has(slug)) return setError("يوجد Slug مكرر: " + slug);
      seen.add(slug);
    }

    setBusy(true);
    setProgress(0);
    const uploaded: string[] = [];
    const urls = new Map<string, string>();
    const progressMap = new Map<string, number>();

    try {
      setStatus("جاري رفع " + items.length + " لعبة...");
      for (let start = 0; start < items.length; start += CONCURRENCY) {
        const batch = items.slice(start, start + CONCURRENCY);
        const results = await Promise.allSettled(batch.map(async (item) => {
          try {
            const url = await uploadOne(item, progressMap);
            uploaded.push(url);
            urls.set(item.id, url);
            update(item.id, { status: "uploaded", progress: 100 });
          } catch (uploadError) {
            update(item.id, { status: "error", error: uploadError instanceof Error ? uploadError.message : "UPLOAD_FAILED" });
            throw uploadError;
          }
        }));
        if (results.some((result) => result.status === "rejected")) throw new Error("فشل رفع ملف واحد أو أكثر.");
      }

      setStatus("تم رفع الملفات. جاري إنشاء الألعاب في قاعدة البيانات...");
      const response = await fetch("/api/admin/games/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ games: items.map((item) => ({
          titleAr: item.titleAr.trim(),
          titleEn: item.titleEn.trim(),
          slug: slugify(item.slug),
          platforms: [item.platform],
          categoryIds,
          price: Number(price || 0),
          discount: Number(discount || 0),
          downloadSource: urls.get(item.id),
          sourceStatus: "LICENSED_FOR_DISTRIBUTION",
          published,
          featured: false,
        })) }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error || "تعذر إنشاء الألعاب.");
      setProgress(100);
      setStatus("تم إنشاء " + (payload.count || items.length) + " لعبة بنجاح.");
      setItems([]);
      setCategoryIds([]);
      setPrice("0");
      setDiscount("0");
      setPublished(true);
      setRights(false);
      const input = document.getElementById("bulk-game-file-input") as HTMLInputElement | null;
      if (input) input.value = "";
    } catch (submitError) {
      await cleanup(uploaded);
      setError(submitError instanceof Error ? submitError.message : "حدث خطأ أثناء الرفع الجماعي.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="glass card" style={{ marginBottom: 20 }}>
    <span className="badge">BULK UPLOAD</span>
    <h2 style={{ marginBottom: 6 }}>رفع عدة ألعاب دفعة واحدة</h2>
    <p className="muted" style={{ margin: 0 }}>حدد أكثر من ملف من الهاتف وارفعها كلها؛ يتم إنشاء لعبة مستقلة لكل ملف.</p>
    <form onSubmit={submit} style={{ display: "grid", gap: 14, marginTop: 18 }}>
      <div className="glass card" style={{ display: "grid", gap: 10 }}>
        <label>ملفات الألعاب *
          <input id="bulk-game-file-input" type="file" multiple disabled={busy} accept=".apk,.aab,.exe,.msi,.zip,.7z,.rar,.iso,.img,.dmg,.pkg,.appimage,.deb,.tar,.gz,.tgz,.obb" onChange={choose} />
        </label>
        <small className="muted">حتى {MAX_FILES} لعبة. الرفع يستخدم multipart وبحد أقصى {CONCURRENCY} ملفات بالتوازي.</small>
      </div>

      {items.length > 0 && <>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <strong>الألعاب المحددة: {items.length}</strong>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => { setItems([]); setProgress(0); const input = document.getElementById("bulk-game-file-input") as HTMLInputElement | null; if (input) input.value = ""; }}>مسح الكل</button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {items.map((item, index) => <div key={item.id} className="glass card" style={{ display: "grid", gap: 10 }}>
            <strong>#{index + 1} · {item.file.name}</strong>
            <small className="muted">{bytes(item.file.size)} · {item.status === "uploaded" ? "تم الرفع" : item.status === "uploading" ? "جاري الرفع " + item.progress + "%" : item.status === "error" ? "فشل" : "بانتظار الرفع"}</small>
            <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
              <label>الاسم بالعربية<input value={item.titleAr} disabled={busy} onChange={(e) => update(item.id, { titleAr: e.target.value })} /></label>
              <label>الاسم بالإنجليزية<input value={item.titleEn} disabled={busy} onChange={(e) => update(item.id, { titleEn: e.target.value })} /></label>
              <label>Slug<input value={item.slug} disabled={busy} onChange={(e) => update(item.id, { slug: slugify(e.target.value) })} /></label>
              <label>المنصة<select value={item.platform} disabled={busy} onChange={(e) => update(item.id, { platform: e.target.value })}>{PLATFORMS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            </div>
            <progress value={item.progress} max={100} />
            {item.error && <small style={{ color: "crimson" }}>{item.error}</small>}
          </div>)}
        </div>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
          <label>السعر لكل لعبة بالدولار<input type="number" min="0" step="0.01" value={price} disabled={busy} onChange={(e) => setPrice(e.target.value)} /></label>
          <label>الخصم % لكل لعبة<input type="number" min="0" max="100" step="1" value={discount} disabled={busy} onChange={(e) => setDiscount(e.target.value)} /></label>
          <label>الفئات لكل الألعاب<select multiple value={categoryIds} disabled={busy} style={{ minHeight: 110 }} onChange={(e) => setCategoryIds(Array.from(e.target.selectedOptions, (option) => option.value))}>{categories.map((category) => <option key={category.id} value={category.id}>{category.nameAr} / {category.nameEn}</option>)}</select></label>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={published} disabled={busy} onChange={(e) => setPublished(e.target.checked)} /> نشر جميع الألعاب بعد الإنشاء</label>
      </>}

      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><input type="checkbox" checked={rights} disabled={busy} onChange={(e) => setRights(e.target.checked)} /> أؤكد أن ملفات الألعاب مملوكة لي أو لدي ترخيص/حق قانوني لتوزيعها على GameVortex.</label>
      {busy && <><progress value={progress} max={100} /><small className="muted">الرفع مباشر إلى Vercel Blob، ويدعم multipart وإعادة محاولة الأجزاء عند ضعف الاتصال.</small></>}
      {status && <p style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(34,197,94,.12)" }}>{status}</p>}
      {error && <p style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(239,68,68,.12)" }}>{error}</p>}
      <button className="btn" type="submit" disabled={busy || !items.length}>{busy ? "جاري الرفع... " + progress + "%" : "رفع وإنشاء كل الألعاب (" + items.length + ")"}</button>
    </form>
  </section>;
}
