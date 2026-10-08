"use client";

import { upload } from "@vercel/blob/client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_UPLOAD_SOURCE_STATUS,
  GAME_FILE_ACCEPT,
  IMAGE_FILE_ACCEPT,
  UPLOAD_PLATFORM_OPTIONS,
  buildBlobPathname,
  canonicalBlobUrl,
  formatBytes,
  gameContentTypeFor,
  hasAllowedGameExtension,
  platformFromFileName,
  slugify,
} from "@/lib/game-upload-shared";

type ContentType = "GAME" | "APP" | "MOD";
type Category = { id: string; nameAr: string; nameEn: string };
type Platform = typeof UPLOAD_PLATFORM_OPTIONS[number][0];
type GameItem = { id: string; titleAr: string; titleEn: string; slug: string };
type ImageItem = { id: string; url: string; sortOrder: number };
type ContentData = {
  games: Array<GameItem & { published: boolean; sourceStatus: string; downloadSource: string | null; coverUrl: string | null; gamePlatforms: { platform: Platform }[]; images: ImageItem[] }>;
  apps: Array<{ id: string; nameAr: string; nameEn: string; slug: string; published: boolean; sourceStatus: string; downloadSource: string | null; coverUrl: string | null; iconUrl: string | null; appPlatforms: { platform: Platform }[]; images: ImageItem[] }>;
  mods: Array<{ id: string; titleAr: string; titleEn: string; slug: string; published: boolean; sourceStatus: string; platform: Platform | null; gameId: string | null; imageUrl: string | null }>;
  categories: Category[];
};

type ImageDraft = { key: string; file: File; preview: string };

const TYPE_LABELS: Record<ContentType, string> = { GAME: "لعبة", APP: "تطبيق", MOD: "MOD" };

export default function ContentManager() {
  const [data, setData] = useState<ContentData>({ games: [], apps: [], mods: [], categories: [] });
  const [type, setType] = useState<ContentType>("GAME");
  const [titleAr, setTitleAr] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [price, setPrice] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [published, setPublished] = useState(true);
  const [sourceMode, setSourceMode] = useState<"upload" | "url">("upload");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [images, setImages] = useState<ImageDraft[]>([]);
  const [gameId, setGameId] = useState("");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const generatedSlug = useMemo(() => slugify(titleEn || titleAr), [titleAr, titleEn]);
  const androidOnly = platforms.length === 1 && platforms[0] === "ANDROID";
  const sourceAccept = androidOnly ? ".apk,.xapk,.apks,.aab,.obb" : GAME_FILE_ACCEPT;

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/content", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload?.success) throw new Error(payload?.error || "تعذر تحميل المحتوى.");
      setData(payload.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "تعذر تحميل المحتوى.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function togglePlatform(value: Platform) {
    setPlatforms((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function toggleCategory(value: string) {
    setCategoryIds((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  function onSourceFile(file: File | null) {
    setSourceFile(file);
    if (file && !platforms.length) setPlatforms([platformFromFileName(file.name) as Platform]);
  }

  function addImages(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files).slice(0, 12 - images.length);
    const drafts = next.map((file) => ({ key: crypto.randomUUID(), file, preview: URL.createObjectURL(file) }));
    setImages((current) => [...current, ...drafts]);
  }

  function removeImage(key: string) {
    setImages((current) => {
      const item = current.find((image) => image.key === key);
      if (item) URL.revokeObjectURL(item.preview);
      return current.filter((image) => image.key !== key);
    });
  }

  async function uploadOne(file: File, kind: "game" | "app" | "image" | "mod") {
    const isImage = kind === "image";
    if (!isImage && !hasAllowedGameExtension(file.name)) throw new Error("صيغة الملف غير مدعومة.");
    if (!file.size) throw new Error("الملف فارغ.");
    const mimeType = isImage ? file.type : gameContentTypeFor(file.name);
    const blob = await upload(
      buildBlobPathname(kind, file.name, crypto.randomUUID()),
      file,
      {
        access: "public",
        handleUploadUrl: "/api/admin/games/upload",
        multipart: !isImage,
        contentType: mimeType,
        clientPayload: JSON.stringify({ kind, mimeType, size: file.size }),
        onUploadProgress(event) {
          setProgress((current) => Math.max(current, Math.round(event.percentage)));
        },
      },
    );
    return blob.url;
  }

  function resetForm() {
    setTitleAr(""); setTitleEn(""); setSlug(""); setDescription(""); setPlatforms([]);
    setCategoryIds([]); setPrice("0"); setDiscount("0"); setPublished(true);
    setSourceMode("upload"); setSourceFile(null); setSourceUrl(""); setGameId("");
    setRightsConfirmed(false); setProgress(0);
    images.forEach((image) => URL.revokeObjectURL(image.preview));
    setImages([]);
    if (imageInputRef.current) imageInputRef.current.value = "";
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setMessage("");

    const finalSlug = slugify(slug || generatedSlug);
    if (!titleAr.trim() || !titleEn.trim() || !finalSlug) return setError("أدخل الاسم بالعربية والإنجليزية.");
    if (!platforms.length) return setError("اختر منصة واحدة.");
    if (type === "MOD" && !gameId) return setError("اختر اللعبة المرتبط بها الـMOD.");
    if (sourceMode === "upload" && !sourceFile) return setError("اختر ملف APK/اللعبة/التطبيق.");
    if (sourceMode === "url" && !sourceUrl.trim()) return setError("أدخل رابطًا واحدًا للملف.");
    if (!rightsConfirmed) return setError("يجب تأكيد حقك في توزيع الملف.");

    setBusy(true); setProgress(0);
    const uploaded: string[] = [];

    try {
      let sourceBlobUrl = "";
      if (sourceMode === "upload" && sourceFile) {
        setMessage("جاري رفع الملف...");
        sourceBlobUrl = await uploadOne(sourceFile, type === "APP" ? "app" : type === "MOD" ? "mod" : "game");
        uploaded.push(sourceBlobUrl);
      }

      const imageUrls: string[] = [];
      for (let index = 0; index < images.length; index += 1) {
        setMessage(`جاري رفع الصورة ${index + 1} من ${images.length}...`);
        const url = await uploadOne(images[index].file, "image");
        imageUrls.push(url);
        uploaded.push(url);
      }

      setMessage(sourceMode === "url" ? "جاري استيراد الرابط إلى التخزين الآمن..." : "جاري حفظ المحتوى...");
      const response = await fetch("/api/admin/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          titleAr: titleAr.trim(),
          titleEn: titleEn.trim(),
          slug: finalSlug,
          description: description.trim(),
          platforms,
          categoryIds,
          price,
          discount,
          published,
          confirmRights: rightsConfirmed,
          gameId: gameId || undefined,
          source: sourceMode === "upload" ? { mode: "upload", blobUrl: sourceBlobUrl } : { mode: "url", url: sourceUrl.trim() },
          imageUrls,
          sourceStatus: DEFAULT_UPLOAD_SOURCE_STATUS,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error || "فشل حفظ المحتوى.");

      setMessage("تمت إضافة المحتوى بنجاح.");
      resetForm();
      await load();
    } catch (err) {
      if (uploaded.length) {
        try {
          await fetch("/api/admin/games/upload", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls: uploaded }),
          });
        } catch {}
      }
      setError(err instanceof Error ? err.message : "حدث خطأ أثناء الإضافة.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="wrap">
      <section className="glass hero">
        <span className="badge">OWNER ONLY</span>
        <h1>إدارة المحتوى</h1>
        <p className="muted">صفحة واحدة لإضافة الألعاب والتطبيقات والـMOD. لا توجد Downloader أو صفحات رفع منفصلة.</p>
      </section>

      <section className="glass card" style={{ marginTop: 16 }}>
        <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
          <div>
            <strong>نوع المحتوى</strong>
            <div className="tabs" style={{ marginTop: 8 }}>
              {(Object.keys(TYPE_LABELS) as ContentType[]).map((value) => (
                <button key={value} type="button" className={type === value ? "btn" : "btn secondary"} onClick={() => setType(value)}>
                  {TYPE_LABELS[value]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            <label>الاسم بالعربية<input value={titleAr} onChange={(event) => setTitleAr(event.target.value)} required /></label>
            <label>الاسم بالإنجليزية<input value={titleEn} onChange={(event) => { setTitleEn(event.target.value); if (!slug) setSlug(slugify(event.target.value)); }} required /></label>
            <label>Slug<input value={slug} onChange={(event) => setSlug(slugify(event.target.value))} placeholder={generatedSlug || "content-name"} required /></label>
            <label>السعر بالدولار<input type="number" min="0" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
            <label>الخصم %<input type="number" min="0" max="100" value={discount} onChange={(event) => setDiscount(event.target.value)} /></label>
          </div>

          <label>الوصف<textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></label>

          <div>
            <strong>المنصة</strong>
            <div className="tabs" style={{ marginTop: 8 }}>
              {UPLOAD_PLATFORM_OPTIONS.map(([value, label]) => (
                <button key={value} type="button" className={platforms.includes(value) ? "btn" : "btn secondary"} onClick={() => togglePlatform(value)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {data.categories.length > 0 && (
            <div>
              <strong>التصنيف</strong>
              <div className="tabs" style={{ marginTop: 8 }}>
                {data.categories.map((category) => (
                  <button key={category.id} type="button" className={categoryIds.includes(category.id) ? "btn" : "btn secondary"} onClick={() => toggleCategory(category.id)}>
                    {category.nameAr}
                  </button>
                ))}
              </div>
            </div>
          )}

          {type === "MOD" && (
            <label>اللعبة المرتبط بها الـMOD
              <select value={gameId} onChange={(event) => setGameId(event.target.value)} required>
                <option value="">اختر اللعبة</option>
                {data.games.map((game) => <option key={game.id} value={game.id}>{game.titleAr} — {game.titleEn}</option>)}
              </select>
            </label>
          )}

          <div className="glass card" style={{ display: "grid", gap: 12 }}>
            <strong>الملف — اختيار واحد فقط</strong>
            <div className="tabs">
              <button type="button" className={sourceMode === "upload" ? "btn" : "btn secondary"} onClick={() => setSourceMode("upload")}>رفع من الهاتف</button>
              <button type="button" className={sourceMode === "url" ? "btn" : "btn secondary"} onClick={() => setSourceMode("url")}>رابط واحد</button>
            </div>
            {sourceMode === "upload" ? (
              <label>ملف {androidOnly ? "APK" : "اللعبة / التطبيق"}
                <input type="file" accept={sourceAccept} onChange={(event) => onSourceFile(event.target.files?.[0] || null)} required />
                {sourceFile && <small className="muted">{sourceFile.name} · {formatBytes(sourceFile.size)}</small>}
              </label>
            ) : (
              <label>رابط الملف
                <input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://example.com/file.apk" required />
                <small className="muted">رابط واحد فقط. سيتم استيراد الملف إلى تخزين GameVortex.</small>
              </label>
            )}
          </div>

          {type !== "MOD" && (
            <div className="glass card" style={{ display: "grid", gap: 12 }}>
              <strong>صور المحتوى — يمكنك إضافة أكثر من صورة</strong>
              <input ref={imageInputRef} type="file" accept={IMAGE_FILE_ACCEPT} multiple onChange={(event) => addImages(event.target.files)} />
              {images.length > 0 && (
                <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
                  {images.map((image, index) => (
                    <div key={image.key} style={{ position: "relative" }}>
                      <img src={image.preview} alt={image.file.name} style={{ width: "100%", aspectRatio: "16/10", objectFit: "cover", borderRadius: 12 }} />
                      <span className="badge" style={{ position: "absolute", top: 6, right: 6 }}>{index === 0 ? "رئيسية" : index + 1}</span>
                      <button type="button" className="btn secondary" style={{ marginTop: 6, width: "100%" }} onClick={() => removeImage(image.key)}>حذف</button>
                    </div>
                  ))}
                </div>
              )}
              <small className="muted">أول صورة تصبح صورة الغلاف/الأيقونة، وباقي الصور تظهر كمعرض للمحتوى.</small>
            </div>
          )}

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={published} onChange={(event) => setPublished(event.target.checked)} />
            نشر بعد الحفظ
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} />
            أؤكد أن لدي حق توزيع الملف/المحتوى.
          </label>

          {busy && <progress value={progress} max={100} />}
          {message && <p style={{ padding: 10, borderRadius: 10, background: "rgba(34,197,94,.12)" }}>{message}</p>}
          {error && <p style={{ padding: 10, borderRadius: 10, background: "rgba(239,68,68,.12)" }}>{error}</p>}

          <button className="btn" type="submit" disabled={busy}>{busy ? "جاري الحفظ..." : "إضافة المحتوى"}</button>
        </form>
      </section>

      <section className="glass card" style={{ marginTop: 16 }}>
        <h2>المحتوى الحالي</h2>
        {loading ? <p className="muted">جاري التحميل...</p> : (
          <div className="grid">
            {data.games.map((item) => (
              <article className="glass card" key={`game-${item.id}`}>
                <span className="badge">لعبة · {item.published ? "منشورة" : "مسودة"}</span>
                <h3>{item.titleAr}</h3>
                <p className="muted">{item.titleEn} · {item.slug}</p>
                <p className="muted">{item.images.length} صورة · {item.downloadSource ? "ملف موجود" : "بدون ملف"}</p>
              </article>
            ))}
            {data.apps.map((item) => (
              <article className="glass card" key={`app-${item.id}`}>
                <span className="badge">تطبيق · {item.published ? "منشور" : "مسودة"}</span>
                <h3>{item.nameAr}</h3>
                <p className="muted">{item.nameEn} · {item.slug}</p>
                <p className="muted">{item.images.length} صورة · {item.downloadSource ? "ملف موجود" : "بدون ملف"}</p>
              </article>
            ))}
            {data.mods.map((item) => (
              <article className="glass card" key={`mod-${item.id}`}>
                <span className="badge">MOD · {item.published ? "منشور" : "مسودة"}</span>
                <h3>{item.titleAr}</h3>
                <p className="muted">{item.titleEn} · {item.slug}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
