
"use client";

import { upload } from "@vercel/blob/client";
import { useMemo, useRef, useState } from "react";
import {
  buildBlobPathname,
  checkGameFile,
  formatBytes,
  gameContentTypeFor,
  slugify,
  type UploadKind,
} from "@/lib/game-upload-shared";

type Category = { id: string; nameAr: string; nameEn: string };
type Platform = "PC"|"PLAYSTATION"|"XBOX"|"NINTENDO"|"ANDROID"|"IOS"|"MAC"|"LINUX"|"STEAM_DECK"|"WEB";

type ExistingGame = {
  id: string; titleAr: string; titleEn: string; slug: string; platform: string | null;
  published: boolean; coverUrl: string | null; galleryUrls: unknown; downloadCount: number;
  updatedAt: Date; gamePlatforms: { platform: string }[];
};
type ExistingApp = {
  id: string; nameAr: string; nameEn: string; slug: string; published: boolean;
  coverUrl: string | null; iconUrl: string | null; galleryUrls: unknown; downloadCount: number;
  updatedAt: Date; appPlatforms: { platform: string }[];
};

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "ANDROID", label: "Android" },
  { value: "PC", label: "PC" },
  { value: "IOS", label: "iPhone / iPad" },
  { value: "MAC", label: "macOS" },
  { value: "LINUX", label: "Linux" },
  { value: "STEAM_DECK", label: "Steam Deck" },
  { value: "PLAYSTATION", label: "PlayStation" },
  { value: "XBOX", label: "Xbox" },
  { value: "NINTENDO", label: "Nintendo" },
  { value: "WEB", label: "Web" },
];

const imageAccept = "image/jpeg,image/png,image/webp,image/avif";

export default function ContentManager({
  categories,
  initialGames,
  initialApps,
}: {
  categories: Category[];
  initialGames: ExistingGame[];
  initialApps: ExistingApp[];
}) {
  const [contentType, setContentType] = useState<"GAME"|"APP">("GAME");
  const [sourceMode, setSourceMode] = useState<"UPLOAD"|"URL">("UPLOAD");
  const [nameAr, setNameAr] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [platform, setPlatform] = useState<Platform>("ANDROID");
  const [categoryId, setCategoryId] = useState("");
  const [developer, setDeveloper] = useState("");
  const [publisher, setPublisher] = useState("");
  const [price, setPrice] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [published, setPublished] = useState(true);
  const [isMod, setIsMod] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [apkFile, setApkFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const generatedSlug = useMemo(() => slugify(nameEn || nameAr), [nameEn, nameAr]);

  function resetForm() {
    setNameAr(""); setNameEn(""); setSlug(""); setDescription("");
    setPlatform("ANDROID"); setCategoryId(""); setDeveloper(""); setPublisher("");
    setPrice("0"); setDiscount("0"); setPublished(true); setIsMod(false);
    setRightsConfirmed(false); setApkFile(null); setSourceUrl(""); setImageFiles([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function uploadOne(file: File, kind: UploadKind) {
    if (kind === "game") {
      const issue = checkGameFile(file);
      if (issue) throw new Error(issue === "UNSUPPORTED_EXTENSION" ? "يجب أن يكون ملف اللعبة APK." : issue === "TOO_LARGE" ? "حجم APK أكبر من الحد المسموح." : "ملف APK فارغ.");
      if (!/\.apk$/i.test(file.name)) throw new Error("هذه الصفحة تقبل APK فقط.");
    }
    const blob = await upload(
      buildBlobPathname(kind, file.name, crypto.randomUUID()),
      file,
      {
        access: "public",
        handleUploadUrl: "/api/admin/games/upload",
        multipart: kind === "game",
        contentType: kind === "game" ? gameContentTypeFor(file.name) : undefined,
        clientPayload: JSON.stringify({ kind, mimeType: file.type, size: file.size }),
        onUploadProgress: (event) => setProgress(Math.max(0, Math.min(99, Math.round(event.percentage)))),
      },
    );
    return blob.url;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null); setStatus(null);
    const finalSlug = slugify(slug || generatedSlug);
    if (!nameAr.trim() || !nameEn.trim() || !finalSlug) return setError("أدخل الاسم بالعربية والإنجليزية.");
    if (!platform) return setError("اختر منصة واحدة.");
    if (!rightsConfirmed) return setError("يجب تأكيد امتلاك حق توزيع APK والصور.");
    if (sourceMode === "UPLOAD" && !apkFile) return setError("اختر ملف APK من الهاتف.");
    if (sourceMode === "UPLOAD" && apkFile && !/\.apk$/i.test(apkFile.name)) return setError("يجب اختيار APK فقط.");
    if (sourceMode === "URL" && !/^https?:\/\//i.test(sourceUrl.trim())) return setError("أدخل رابط APK صحيحًا.");
    if (contentType === "APP") setIsMod(false);

    setBusy(true); setProgress(0);
    try {
      let downloadSource = "";
      const imageUrls: string[] = [];

      if (sourceMode === "UPLOAD" && apkFile) {
        setStatus("جاري رفع APK...");
        downloadSource = await uploadOne(apkFile, "game");
      } else {
        setStatus("سيتم تنزيل APK من الرابط الآمن على الخادم...");
      }

      for (let i = 0; i < imageFiles.length; i += 1) {
        setStatus(`جاري رفع الصورة ${i + 1} من ${imageFiles.length}...`);
        imageUrls.push(await uploadOne(imageFiles[i], "cover"));
      }

      setStatus("جاري حفظ المحتوى...");
      const response = await fetch("/api/admin/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentType,
          sourceMode,
          sourceUrl: sourceMode === "URL" ? sourceUrl.trim() : undefined,
          downloadSource: sourceMode === "UPLOAD" ? downloadSource : undefined,
          titleAr: nameAr.trim(),
          titleEn: nameEn.trim(),
          nameAr: nameAr.trim(),
          nameEn: nameEn.trim(),
          slug: finalSlug,
          description,
          platform,
          categoryId,
          developer,
          publisher,
          priceCents: Math.max(0, Math.round(Number(price || 0) * 100)),
          discountPercent: Math.min(100, Math.max(0, Math.round(Number(discount || 0)))),
          published,
          isMod: contentType === "GAME" ? isMod : false,
          galleryUrls: imageUrls,
          rightsConfirmed,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.message || payload?.error || "تعذر حفظ المحتوى.");

      setProgress(100);
      setStatus("تمت الإضافة بنجاح.");
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "حدث خطأ أثناء الإضافة.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section className="glass card">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          <button type="button" className={contentType === "GAME" ? "btn" : "btn secondary"} onClick={() => setContentType("GAME")}>🎮 لعبة</button>
          <button type="button" className={contentType === "APP" ? "btn" : "btn secondary"} onClick={() => setContentType("APP")}>▦ تطبيق</button>
        </div>

        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            <label>الاسم بالعربية<input value={nameAr} onChange={(e) => setNameAr(e.target.value)} required /></label>
            <label>الاسم بالإنجليزية<input value={nameEn} onChange={(e) => { setNameEn(e.target.value); if (!slug) setSlug(slugify(e.target.value)); }} required /></label>
            <label>الرابط الداخلي<input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} placeholder={generatedSlug || "content-name"} required /></label>
            {contentType === "APP" && <label>المطور<input value={developer} onChange={(e) => setDeveloper(e.target.value)} /></label>}
            {contentType === "APP" && <label>الناشر<input value={publisher} onChange={(e) => setPublisher(e.target.value)} /></label>}
            <label>المنصة
              <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
                {PLATFORMS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>التصنيف
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">بدون تصنيف</option>
                {categories.map((item) => <option key={item.id} value={item.id}>{item.nameAr}</option>)}
              </select>
            </label>
            <label>السعر بالدولار<input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
            <label>الخصم %<input type="number" min="0" max="100" step="1" value={discount} onChange={(e) => setDiscount(e.target.value)} /></label>
          </div>

          <label>الوصف<textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></label>

          {contentType === "GAME" && (
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={isMod} onChange={(e) => setIsMod(e.target.checked)} />
              هذا المحتوى MOD
            </label>
          )}

          <div className="glass card" style={{ display: "grid", gap: 10 }}>
            <strong>ملف APK</strong>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className={sourceMode === "UPLOAD" ? "btn" : "btn secondary"} onClick={() => setSourceMode("UPLOAD")}>📱 رفع من الهاتف</button>
              <button type="button" className={sourceMode === "URL" ? "btn" : "btn secondary"} onClick={() => setSourceMode("URL")}>🔗 رابط APK واحد</button>
            </div>
            {sourceMode === "UPLOAD" ? (
              <label>APK<input ref={inputRef} type="file" accept=".apk,application/vnd.android.package-archive" onChange={(e) => setApkFile(e.target.files?.[0] || null)} required />{apkFile && <small className="muted">{apkFile.name} · {formatBytes(apkFile.size)}</small>}</label>
            ) : (
              <label>رابط APK<input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://example.com/game.apk" inputMode="url" required /></label>
            )}
          </div>

          <div className="glass card">
            <strong>صور اللعبة / التطبيق</strong>
            <p className="muted">يمكنك اختيار عدة صور لنفس المحتوى. أول صورة تصبح الصورة الرئيسية.</p>
            <input type="file" accept={imageAccept} multiple onChange={(e) => setImageFiles(Array.from(e.target.files || []).slice(0, 12))} />
            {imageFiles.length > 0 && (
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", marginTop: 12 }}>
                {imageFiles.map((file, index) => (
                  <div className="glass card" key={file.name + file.size + index}>
                    <img src={URL.createObjectURL(file)} alt="" style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", borderRadius: 10 }} />
                    <small>{index === 0 ? "الصورة الرئيسية" : `الصورة ${index + 1}`}</small>
                    <button type="button" className="btn secondary" onClick={() => setImageFiles((items) => items.filter((_, i) => i !== index))}>حذف</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} /> نشر بعد الحفظ</label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><input type="checkbox" checked={rightsConfirmed} onChange={(e) => setRightsConfirmed(e.target.checked)} /> أؤكد أن لدي حق توزيع APK والصور المرفوعة.</label>

          {busy && <><progress value={progress} max={100} /><small className="muted">لا تغلق الصفحة أثناء الرفع.</small></>}
          {status && <p style={{ padding: 10, borderRadius: 10, background: "rgba(34,197,94,.12)" }}>{status}</p>}
          {error && <p style={{ padding: 10, borderRadius: 10, background: "rgba(239,68,68,.12)" }}>{error}</p>}
          <button className="btn" type="submit" disabled={busy}>{busy ? `جاري الحفظ... ${progress}%` : "إضافة المحتوى"}</button>
        </form>
      </section>

      <section className="glass card">
        <h2>المحتوى الحالي</h2>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
          {initialGames.map((item) => (
            <article className="glass card" key={item.id}>
              <span className="badge">لعبة · {item.gamePlatforms[0]?.platform || item.platform || "—"}</span>
              <h3>{item.titleAr}</h3>
              <p className="muted">{item.titleEn}</p>
              <p>{item.published ? "منشورة" : "مسودة"} · {item.downloadCount} تحميل</p>
            </article>
          ))}
          {initialApps.map((item) => (
            <article className="glass card" key={item.id}>
              <span className="badge">تطبيق · {item.appPlatforms[0]?.platform || "—"}</span>
              <h3>{item.nameAr}</h3>
              <p className="muted">{item.nameEn}</p>
              <p>{item.published ? "منشور" : "مسودة"} · {item.downloadCount} تحميل</p>
            </article>
          ))}
          {!initialGames.length && !initialApps.length && <p className="muted">لا يوجد محتوى بعد.</p>}
        </div>
      </section>
    </div>
  );
}
