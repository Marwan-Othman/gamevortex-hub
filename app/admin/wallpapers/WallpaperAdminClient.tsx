"use client";

import { FormEvent, useState } from "react";

type Wallpaper = {
  id: string; titleAr: string; titleEn: string; imageUrl: string; thumbnailUrl: string | null; type: "MOBILE" | "DESKTOP";
  category: string; tags: string[]; isVip: boolean; published: boolean; featured: boolean; viewCount: number; downloadCount: number; sourceStatus: string;
};

type FormState = {
  titleAr: string; titleEn: string; descriptionAr: string; descriptionEn: string; imageUrl: string; thumbnailUrl: string; downloadUrl: string;
  sourceUrl: string; licenseUrl: string; attribution: string; sourceStatus: string; type: "MOBILE" | "DESKTOP"; category: string; tags: string;
  resolution: string; isVip: boolean; published: boolean; featured: boolean; sortOrder: string;
};

const categories = ["GAMING", "ANIME", "CYBERPUNK", "CARS", "SPORTS", "NATURE", "SPACE", "FANTASY", "ABSTRACT", "ARABIC", "ISLAMIC", "TECHNOLOGY", "MINIMAL", "AI", "NEON", "GAMEVORTEX", "OTHER"];
const emptyForm: FormState = { titleAr: "", titleEn: "", descriptionAr: "", descriptionEn: "", imageUrl: "", thumbnailUrl: "", downloadUrl: "", sourceUrl: "", licenseUrl: "", attribution: "", sourceStatus: "NEEDS_SOURCE", type: "MOBILE", category: "GAMING", tags: "gaming, wallpaper", resolution: "", isVip: false, published: false, featured: false, sortOrder: "0" };

export default function WallpaperAdminClient({ initialWallpapers }: { initialWallpapers: Wallpaper[] }) {
  const [wallpapers, setWallpapers] = useState(initialWallpapers);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function update<K extends keyof FormState>(key: K, value: FormState[K]) { setForm(current => ({ ...current, [key]: value })); }

  async function createWallpaper(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const payload = { ...form, tags: form.tags.split(",").map(s => s.trim()).filter(Boolean), sortOrder: Number(form.sortOrder) || 0 };
      const response = await fetch("/api/admin/wallpapers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "فشل إنشاء الخلفية");
      setWallpapers(current => [result.data, ...current]); setForm(emptyForm); setMessage("تمت إضافة الخلفية. إذا أردت نشرها، يجب أن يكون المصدر والترخيص موثوقين.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "حدث خطأ غير متوقع"); } finally { setBusy(false); }
  }

  async function patch(id: string, data: Record<string, unknown>) {
    const response = await fetch("/api/admin/wallpapers", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...data }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "فشل التحديث");
    setWallpapers(current => current.map(item => item.id === id ? result.data : item));
  }

  async function toggle(id: string, field: "published" | "featured" | "isVip") {
    const item = wallpapers.find(w => w.id === id); if (!item) return;
    try { await patch(id, { [field]: !item[field] }); } catch (error) { setMessage(error instanceof Error ? error.message : "فشل التحديث"); }
  }

  async function deleteWallpaper(id: string) {
    if (!window.confirm("هل تريد حذف هذه الخلفية نهائيًا؟")) return;
    try {
      const response = await fetch(`/api/admin/wallpapers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "فشل الحذف");
      setWallpapers(current => current.filter(item => item.id !== id)); setMessage("تم حذف الخلفية.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "فشل الحذف"); }
  }

  return <>
    <section className="glass card" style={{ marginTop: 20 }}>
      <h2>إضافة خلفية</h2>
      <p className="muted">يمكنك تجهيزها كـFREE أو VIP. لا تنشر صورة قبل التحقق من المصدر والترخيص.</p>
      <form onSubmit={createWallpaper} style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <div className="filter-row"><input className="input" value={form.titleAr} onChange={e => update("titleAr", e.target.value)} placeholder="العنوان بالعربية" required /><input className="input" value={form.titleEn} onChange={e => update("titleEn", e.target.value)} placeholder="English title" required /></div>
        <div className="filter-row"><input className="input" type="url" value={form.imageUrl} onChange={e => update("imageUrl", e.target.value)} placeholder="Image HTTPS URL" required /><input className="input" type="url" value={form.thumbnailUrl} onChange={e => update("thumbnailUrl", e.target.value)} placeholder="Thumbnail HTTPS URL" /></div>
        <div className="filter-row"><input className="input" type="url" value={form.downloadUrl} onChange={e => update("downloadUrl", e.target.value)} placeholder="Download HTTPS URL" /><input className="input" type="url" value={form.sourceUrl} onChange={e => update("sourceUrl", e.target.value)} placeholder="Source URL (required to publish)" /></div>
        <div className="filter-row"><input className="input" type="url" value={form.licenseUrl} onChange={e => update("licenseUrl", e.target.value)} placeholder="License URL" /><input className="input" value={form.attribution} onChange={e => update("attribution", e.target.value)} placeholder="Attribution" /></div>
        <div className="filter-row"><select className="input" value={form.sourceStatus} onChange={e => update("sourceStatus", e.target.value)}><option>NEEDS_SOURCE</option><option>VERIFIED</option><option>OPEN_SOURCE</option><option>OFFICIAL_SOURCE</option><option>FREEWARE_REDISTRIBUTABLE</option><option>LICENSED_FOR_DISTRIBUTION</option></select><select className="input" value={form.type} onChange={e => update("type", e.target.value as FormState["type"])}><option value="MOBILE">MOBILE</option><option value="DESKTOP">DESKTOP</option></select><select className="input" value={form.category} onChange={e => update("category", e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></div>
        <div className="filter-row"><input className="input" value={form.tags} onChange={e => update("tags", e.target.value)} placeholder="gaming, neon, 4k" /><input className="input" value={form.resolution} onChange={e => update("resolution", e.target.value)} placeholder="3840x2160" /><input className="input" type="number" value={form.sortOrder} onChange={e => update("sortOrder", e.target.value)} placeholder="Sort" /></div>
        <div className="filter-row"><textarea className="input" value={form.descriptionAr} onChange={e => update("descriptionAr", e.target.value)} placeholder="الوصف بالعربية" rows={3} /><textarea className="input" value={form.descriptionEn} onChange={e => update("descriptionEn", e.target.value)} placeholder="English description" rows={3} /></div>
        <div className="tabs"><label className="badge"><input type="checkbox" checked={form.isVip} onChange={e => update("isVip", e.target.checked)} /> 💎 VIP</label><label className="badge"><input type="checkbox" checked={form.published} onChange={e => update("published", e.target.checked)} /> منشورة</label><label className="badge"><input type="checkbox" checked={form.featured} onChange={e => update("featured", e.target.checked)} /> ⭐ مميزة</label></div>
        <button className="btn" type="submit" disabled={busy}>{busy ? "جارٍ الحفظ…" : "إضافة الخلفية"}</button>
        {message && <p className="muted" role="status">{message}</p>}
      </form>
    </section>

    <section style={{ marginTop: 24 }}><div className="section-head"><h2>الخلفيات الحالية ({wallpapers.length})</h2></div><div className="grid">{wallpapers.map(w => <article className="glass card" key={w.id} style={{ overflow: "hidden" }}><img src={w.thumbnailUrl || w.imageUrl} alt={w.titleEn} loading="lazy" style={{ width: "100%", aspectRatio: w.type === "MOBILE" ? "9 / 16" : "16 / 9", objectFit: "cover", display: "block", borderRadius: 14 }} /><div style={{ display: "grid", gap: 8, marginTop: 14 }}><div className="card-top"><strong>{w.titleAr}</strong><span className="badge">{w.isVip ? "💎 VIP" : "🆓 FREE"}</span></div><p className="muted">{w.titleEn} · {w.category}</p><p className="muted">المصدر: {w.sourceStatus} · المشاهدات: {w.viewCount} · التحميلات: {w.downloadCount}</p><div className="tabs"><button className="btn" type="button" onClick={() => toggle(w.id, "published")}>{w.published ? "إلغاء النشر" : "نشر"}</button><button className="btn" type="button" onClick={() => toggle(w.id, "isVip")}>{w.isVip ? "جعله FREE" : "جعله VIP"}</button><button className="btn" type="button" onClick={() => toggle(w.id, "featured")}>{w.featured ? "إلغاء التمييز" : "تمييز"}</button><button className="btn secondary" type="button" onClick={() => deleteWallpaper(w.id)}>حذف</button></div></div></article>)}</div>{!wallpapers.length && <p className="muted">لا توجد خلفيات في قاعدة البيانات حاليًا.</p>}</section>
  </>;
}
