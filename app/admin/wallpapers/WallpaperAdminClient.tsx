"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, SyntheticEvent } from "react";
import { upload } from "@vercel/blob/client";

type Wallpaper = {
  id: string;
  titleAr: string;
  titleEn: string;
  imageUrl: string;
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

type SourceMode = "IMAGE" | "ANIMATED";
type InputMode = "FILE" | "URL";

type FormState = {
  sourceMode: SourceMode;
  inputMode: InputMode;
  imageUrl: string;
  isVip: boolean;
  published: boolean;
  featured: boolean;
};

const MAX_FILE_SIZE = 100 * 1024 * 1024;

const emptyForm: FormState = {
  sourceMode: "IMAGE",
  inputMode: "FILE",
  imageUrl: "",
  isVip: false,
  published: false,
  featured: false,
};

function isAnimatedMimeType(type: string) {
  return ["image/gif", "image/webp", "image/apng", "image/avif"].includes(type.toLowerCase());
}

function detectType(width: number, height: number): "MOBILE" | "DESKTOP" {
  return height > width ? "MOBILE" : "DESKTOP";
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-120) || "wallpaper";
}

function imageRatio(width?: number | null, height?: number | null, type?: "MOBILE" | "DESKTOP") {
  if (width && height && width > 0 && height > 0) return `${width} / ${height}`;
  return type === "MOBILE" ? "9 / 16" : "16 / 9";
}

export default function WallpaperAdminClient({
  initialWallpapers,
}: {
  initialWallpapers: Wallpaper[];
}) {
  const [wallpapers, setWallpapers] = useState(initialWallpapers);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const accept = useMemo(
    () => form.sourceMode === "ANIMATED"
      ? ".gif,.webp,.apng,.avif,image/gif,image/webp,image/apng,image/avif"
      : ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp",
    [form.sourceMode],
  );

  useEffect(() => {
    return () => {
      if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function resetForm() {
    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    setForm(emptyForm);
    setFile(null);
    setPreviewUrl("");
    setDimensions({ width: 0, height: 0 });
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleFileChange(nextFile: File | null) {
    setMessage("");
    setFile(nextFile);
    setDimensions({ width: 0, height: 0 });

    if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);

    if (!nextFile) {
      setPreviewUrl("");
      return;
    }

    if (!nextFile.type.startsWith("image/")) {
      setFile(null);
      setPreviewUrl("");
      setMessage("الملف المختار ليس صورة مدعومة.");
      return;
    }

    if (nextFile.size <= 0 || nextFile.size > MAX_FILE_SIZE) {
      setFile(null);
      setPreviewUrl("");
      setMessage("حجم الصورة يجب ألا يتجاوز 100MB.");
      return;
    }

    const detectedAnimated = isAnimatedMimeType(nextFile.type);
    if (detectedAnimated && form.sourceMode !== "ANIMATED") {
      update("sourceMode", "ANIMATED");
    }

    setPreviewUrl(URL.createObjectURL(nextFile));
  }

  function handlePreviewLoad(event: SyntheticEvent<HTMLImageElement>) {
    const width = event.currentTarget.naturalWidth;
    const height = event.currentTarget.naturalHeight;
    if (width && height) setDimensions({ width, height });
  }

  async function createWallpaper(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setProgress(0);
    setMessage("");

    try {
      let payload: Record<string, unknown>;

      if (form.inputMode === "FILE") {
        if (!file) throw new Error("اختر صورة من الهاتف أولًا.");
        if (!file.type.startsWith("image/")) throw new Error("صيغة الصورة غير مدعومة.");
        if (file.size > MAX_FILE_SIZE) throw new Error("حجم الصورة أكبر من 100MB.");

        const blob = await upload(
          `wallpapers/${Date.now()}-${crypto.randomUUID()}-${safeFileName(file.name)}`,
          file,
          {
            access: "public",
            handleUploadUrl: "/api/admin/wallpapers/upload",
            multipart: true,
            onUploadProgress(event) {
              setProgress(Math.round(event.percentage));
            },
          },
        );

        payload = {
          sourceType: "BLOB",
          imageUrl: blob.url,
          originalFilename: file.name,
          mimeType: file.type,
          fileSizeBytes: file.size,
          isAnimated: isAnimatedMimeType(file.type),
          width: dimensions.width || undefined,
          height: dimensions.height || undefined,
          type: dimensions.width && dimensions.height ? detectType(dimensions.width, dimensions.height) : undefined,
          isVip: form.isVip,
          published: form.published,
          featured: form.featured,
        };
      } else {
        const imageUrl = form.imageUrl.trim();
        if (!imageUrl) throw new Error("ضع رابط الصورة أولًا.");
        if (!/^https:\/\//i.test(imageUrl)) throw new Error("الرابط يجب أن يبدأ بـ HTTPS.");

        payload = {
          sourceType: "URL",
          sourceUrl: imageUrl,
          width: dimensions.width || undefined,
          height: dimensions.height || undefined,
          type: dimensions.width && dimensions.height ? detectType(dimensions.width, dimensions.height) : undefined,
          isVip: form.isVip,
          published: form.published,
          featured: form.featured,
        };
      }

      const response = await fetch("/api/admin/wallpapers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "فشل إنشاء الخلفية");

      setWallpapers((current) => [result.data, ...current]);
      resetForm();
      setMessage("تمت إضافة الخلفية بنجاح بدون ضغط أو تحويل للصورة الأصلية.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "حدث خطأ غير متوقع");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, data: Record<string, unknown>) {
    const response = await fetch("/api/admin/wallpapers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ...data }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "فشل التحديث");
    setWallpapers((current) => current.map((item) => item.id === id ? result.data : item));
  }

  async function toggle(id: string, field: "published" | "featured" | "isVip") {
    const item = wallpapers.find((wallpaper) => wallpaper.id === id);
    if (!item) return;
    try {
      await patch(id, { [field]: !item[field] });
      setMessage("تم تحديث الخلفية.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل التحديث");
    }
  }

  async function deleteWallpaper(id: string) {
    if (!window.confirm("هل تريد حذف هذه الخلفية نهائيًا؟")) return;
    try {
      const response = await fetch(`/api/admin/wallpapers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "فشل الحذف");
      setWallpapers((current) => current.filter((item) => item.id !== id));
      setMessage("تم حذف الخلفية.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل الحذف");
    }
  }

  return (
    <>
      <section className="glass card" style={{ marginTop: 20 }}>
        <h2>إضافة خلفية</h2>
        <p className="muted" style={{ marginTop: 8 }}>
          ارفع الصورة من الهاتف أو ضع رابطها. الملف الأصلي يُحفظ كما هو، والصور المتحركة تبقى متحركة.
        </p>

        <form onSubmit={createWallpaper} style={{ display: "grid", gap: 16, marginTop: 20 }}>
          <div className="tabs" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button className={`btn ${form.sourceMode === "IMAGE" ? "" : "secondary"}`} type="button" onClick={() => update("sourceMode", "IMAGE")}>
              🖼️ صورة عادية
            </button>
            <button className={`btn ${form.sourceMode === "ANIMATED" ? "" : "secondary"}`} type="button" onClick={() => update("sourceMode", "ANIMATED")}>
              🎞️ صورة متحركة
            </button>
          </div>

          <div className="tabs" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button className={`btn ${form.inputMode === "FILE" ? "" : "secondary"}`} type="button" onClick={() => update("inputMode", "FILE")}>
              📱 رفع من الهاتف
            </button>
            <button className={`btn ${form.inputMode === "URL" ? "" : "secondary"}`} type="button" onClick={() => update("inputMode", "URL")}>
              🔗 استخدام رابط
            </button>
          </div>

          {form.inputMode === "FILE" ? (
            <div style={{ display: "grid", gap: 10 }}>
              <label className="btn" style={{ cursor: busy ? "not-allowed" : "pointer", textAlign: "center" }}>
                {file ? `📁 ${file.name}` : "📱 اختر صورة من الهاتف"}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={accept}
                  onChange={(event) => handleFileChange(event.target.files?.[0] || null)}
                  disabled={busy}
                  style={{ display: "none" }}
                />
              </label>
              <p className="muted" style={{ fontSize: 13 }}>
                الحد الأقصى 100MB. JPG / PNG / WebP / GIF / APNG / AVIF حسب نوع الصورة.
              </p>
            </div>
          ) : (
            <input
              className="input"
              type="url"
              value={form.imageUrl}
              onChange={(event) => update("imageUrl", event.target.value)}
              onBlur={() => setPreviewUrl(form.imageUrl.trim())}
              placeholder={form.sourceMode === "ANIMATED" ? "رابط GIF / WebP / APNG / AVIF HTTPS" : "رابط الصورة HTTPS"}
              required
            />
          )}

          {previewUrl && (
            <div style={{ overflow: "hidden", borderRadius: 18, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(0,0,0,0.30)", padding: 8 }}>
              <img
                src={previewUrl}
                alt="معاينة الخلفية"
                onLoad={handlePreviewLoad}
                style={{ display: "block", width: "100%", maxHeight: 520, objectFit: "contain", borderRadius: 14 }}
              />
              {(dimensions.width > 0 && dimensions.height > 0) && (
                <p className="muted" style={{ margin: "8px 4px 0", textAlign: "center" }}>
                  {dimensions.width} × {dimensions.height} · {detectType(dimensions.width, dimensions.height)}
                </p>
              )}
            </div>
          )}

          <div className="tabs" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label className="badge"><input type="checkbox" checked={form.isVip} onChange={(event) => update("isVip", event.target.checked)} /> 💎 VIP</label>
            <label className="badge"><input type="checkbox" checked={form.published} onChange={(event) => update("published", event.target.checked)} /> 📢 منشورة</label>
            <label className="badge"><input type="checkbox" checked={form.featured} onChange={(event) => update("featured", event.target.checked)} /> ⭐ مميزة</label>
          </div>

          {busy && form.inputMode === "FILE" && (
            <div className="glass" style={{ padding: 12 }}>
              <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,.10)", overflow: "hidden" }}>
                <div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(90deg,#b84cff,#6b3df5)", transition: "width .2s ease" }} />
              </div>
              <p className="muted" style={{ marginTop: 8, textAlign: "center" }}>رفع الملف {progress}%</p>
            </div>
          )}

          <button className="btn" type="submit" disabled={busy}>
            {busy ? "جارٍ رفع وإضافة الخلفية…" : "إضافة الخلفية"}
          </button>

          {message && <p className="muted" role="status">{message}</p>}
        </form>
      </section>

      <section style={{ marginTop: 24 }}>
        <div className="section-head"><h2>الخلفيات الحالية ({wallpapers.length})</h2></div>
        <div className="grid">
          {wallpapers.map((wallpaper) => (
            <article className="glass card" key={wallpaper.id} style={{ overflow: "hidden" }}>
              <div style={{ width: "100%", background: "rgba(0,0,0,.28)", borderRadius: 14, overflow: "hidden" }}>
                {wallpaper.isAnimated ? (
                  <img src={wallpaper.imageUrl} alt="GameVortex Wallpaper" loading="lazy" style={{ width: "100%", aspectRatio: imageRatio(wallpaper.width, wallpaper.height, wallpaper.type), objectFit: "contain", display: "block" }} />
                ) : (
                  <img src={wallpaper.thumbnailUrl || wallpaper.imageUrl} alt="GameVortex Wallpaper" loading="lazy" style={{ width: "100%", aspectRatio: imageRatio(wallpaper.width, wallpaper.height, wallpaper.type), objectFit: "contain", display: "block" }} />
                )}
              </div>

              <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                <div className="card-top">
                  <strong>GameVortex Wallpaper</strong>
                  <span className="badge">{wallpaper.isVip ? "💎 VIP" : "🆓 FREE"}</span>
                </div>
                <p className="muted">
                  {wallpaper.published ? "📢 منشورة" : "🔒 غير منشورة"} · {wallpaper.featured ? "⭐ مميزة" : "عادية"}
                  {wallpaper.isAnimated ? " · 🎞️ متحركة" : ""}
                </p>
                <p className="muted">{wallpaper.width && wallpaper.height ? `${wallpaper.width}×${wallpaper.height} · ` : ""}👁️ {wallpaper.viewCount} · ↓ {wallpaper.downloadCount}</p>

                <div className="tabs" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn" type="button" onClick={() => toggle(wallpaper.id, "published")}>{wallpaper.published ? "إلغاء النشر" : "نشر"}</button>
                  <button className="btn" type="button" onClick={() => toggle(wallpaper.id, "isVip")}>{wallpaper.isVip ? "جعله FREE" : "جعله VIP"}</button>
                  <button className="btn" type="button" onClick={() => toggle(wallpaper.id, "featured")}>{wallpaper.featured ? "إلغاء التمييز" : "تمييز"}</button>
                  <button className="btn secondary" type="button" onClick={() => deleteWallpaper(wallpaper.id)}>حذف</button>
                </div>
              </div>
            </article>
          ))}
        </div>

        {!wallpapers.length && <p className="muted">لا توجد خلفيات في قاعدة البيانات حاليًا.</p>}
      </section>
    </>
  );
}
