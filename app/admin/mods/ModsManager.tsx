"use client";

import { useState } from "react";

const empty = {
  slug: "",
  titleAr: "",
  titleEn: "",
  descriptionAr: "",
  descriptionEn: "",
  imageUrl: "",
  modUrl: "",
  downloadUrl: "",
  sourceUrl: "",
  sourceProvider: "",
  platform: "",
  gameId: "",
  published: false,
  featured: false,
  sortOrder: 0,
};

type ModItem = {
  id: string;
  slug: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  imageUrl: string | null;
  modUrl: string | null;
  downloadUrl: string | null;
  sourceUrl: string | null;
  sourceProvider: string | null;
  sourceStatus: string;
  platform: string | null;
  gameId: string | null;
  published: boolean;
  featured: boolean;
  sortOrder: number;
};

export default function ModsManager({ initialMods }: { initialMods: ModItem[] }) {
  const [mods, setMods] = useState(initialMods);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const update = (key: keyof typeof empty, value: string | boolean | number) => setForm((x) => ({ ...x, [key]: value }));

  async function save() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/mods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "MOD_SAVE_FAILED");
      setMods((current) => [data.mod, ...current]);
      setForm(empty);
      setMessage("تم حفظ الـMod.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "MOD_SAVE_FAILED"); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm("حذف هذا الـMod؟")) return;
    const response = await fetch(`/api/admin/mods?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.ok) setMods((current) => current.filter((x) => x.id !== id));
  }

  return (
    <main dir="rtl">
      <section className="glass hero">
        <span className="badge">MOD CONTROL</span>
        <h1>إدارة Mods</h1>
        <p className="muted">القسم يبدأ فارغًا. أضف فقط مودات لها مصدر حقيقي وبيانات يمكن التحقق منها.</p>
      </section>
      <section className="glass card" style={{ marginTop: 16 }}>
        <h2>إضافة Mod</h2>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
          {(["slug","titleAr","titleEn","imageUrl","modUrl","downloadUrl","sourceUrl","sourceProvider","gameId"] as const).map((key) => (
            <label key={key} style={{ display: "grid", gap: 6 }}>
              <span>{key}</span>
              <input value={form[key]} onChange={(e) => update(key, e.target.value)} />
            </label>
          ))}
          <label style={{ display: "grid", gap: 6 }}><span>platform</span><select value={form.platform} onChange={(e) => update("platform", e.target.value)}><option value="">Multi / غير محدد</option>{["PC","PLAYSTATION","XBOX","NINTENDO","ANDROID","IOS","MAC","LINUX","STEAM_DECK","WEB"].map((x) => <option key={x}>{x}</option>)}</select></label>
          <label style={{ display: "grid", gap: 6 }}><span>sortOrder</span><input type="number" value={form.sortOrder} onChange={(e) => update("sortOrder", Number(e.target.value) || 0)} /></label>
        </div>
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          <textarea placeholder="الوصف العربي" value={form.descriptionAr} onChange={(e) => update("descriptionAr", e.target.value)} />
          <textarea placeholder="English description" value={form.descriptionEn} onChange={(e) => update("descriptionEn", e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
          <label><input type="checkbox" checked={form.published} onChange={(e) => update("published", e.target.checked)} /> نشر</label>
          <label><input type="checkbox" checked={form.featured} onChange={(e) => update("featured", e.target.checked)} /> مميز</label>
        </div>
        <button className="btn" disabled={busy || !form.slug || !form.titleAr || !form.titleEn} onClick={save}>{busy ? "جارٍ الحفظ…" : "حفظ Mod"}</button>
        {message ? <p className="muted">{message}</p> : null}
      </section>
      <section className="grid" style={{ marginTop: 16 }}>
        {mods.map((mod) => <article className="glass card" key={mod.id}><span className="badge">{mod.published ? "PUBLISHED" : "DRAFT"}</span><h3>{mod.titleAr}</h3><p className="muted">{mod.titleEn} · {mod.sourceStatus}</p><button className="btn" onClick={() => remove(mod.id)}>حذف</button></article>)}
        {!mods.length ? <article className="glass card"><h3>لا توجد Mods</h3><p className="muted">وهذا مقصود حاليًا، حتى نضيف محتوى حقيقي فقط.</p></article> : null}
      </section>
    </main>
  );
}
