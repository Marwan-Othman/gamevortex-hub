"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  GAME_FILE_ACCEPT,
  UPLOAD_PLATFORM_OPTIONS,
  buildBlobPathname,
  formatBytes,
  gameContentTypeFor,
  hasAllowedGameExtension,
  MAX_COVER_FILE_SIZE,
  COVER_CONTENT_TYPES,
  MAX_GAME_FILE_SIZE,
  type UploadKind,
} from "@/lib/game-upload-shared";
import {
  MAX_SCREENSHOTS,
  normalizeExternalSourceUrl,
  type ContentFormData,
  type ContentType,
  type SourceMode,
} from "@/lib/content-admin";

export type ContentListItem = {
  id: string;
  type: ContentType;
  name: string;
  slug: string;
  isMod: boolean;
  published: boolean;
  image: string | null;
  platform: string | null;
  updatedAt: number;
};

/** An image is either already stored (url) or a local file waiting to be uploaded on save. */
type ImageItem = { key: string; url?: string; file?: File; preview: string };

const ERRORS: Record<string, string> = {
  NAME_REQUIRED: "اكتب الاسم.",
  NAME_TOO_LONG: "الاسم طويل جدًا.",
  DESCRIPTION_TOO_LONG: "الشرح طويل جدًا.",
  INVALID_PLATFORM: "المنصة غير صحيحة.",
  INVALID_MAIN_IMAGE: "الصورة الرئيسية غير صالحة.",
  INVALID_SCREENSHOT: "إحدى الصور التعريفية غير صالحة.",
  TOO_MANY_SCREENSHOTS: "عدد الصور التعريفية أكبر من المسموح.",
  INVALID_UPLOADED_FILE: "ملف التطبيق المرفوع غير صالح.",
  APK_FILE_REQUIRED: "لمنصة Android يجب أن يكون الملف بصيغة APK.",
  INVALID_APK_LINK: "رابط APK غير صالح. يجب أن يكون رابط https عام.",
  SOURCE_REQUIRED: "أضف ملف APK أو رابط APK.",
  FILE_ALREADY_USED: "أحد الملفات مستخدم في محتوى آخر.",
  Unauthorized: "سجّل الدخول بحساب المالك.",
  Forbidden: "هذه الصفحة للمالك فقط.",
  NOT_FOUND: "المحتوى غير موجود.",
};

function errorText(code: unknown) {
  return typeof code === "string" && ERRORS[code] ? ERRORS[code] : "تعذر الحفظ. حاول مرة ثانية.";
}

function newKey() {
  return crypto.randomUUID();
}

export default function ContentManager({ items }: { items: ContentListItem[] }) {
  const router = useRouter();

  const [editing, setEditing] = useState<{ type: ContentType; id: string } | null>(null);
  const [type, setType] = useState<ContentType>("game");
  const [platform, setPlatform] = useState("ANDROID");
  const [isMod, setIsMod] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [published, setPublished] = useState(true);
  const [sourceMode, setSourceMode] = useState<SourceMode>("upload");
  const [apkFile, setApkFile] = useState<File | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [existingSource, setExistingSource] = useState<{ mode: SourceMode; url: string } | null>(null);
  const [mainImage, setMainImage] = useState<ImageItem | null>(null);
  const [screenshots, setScreenshots] = useState<ImageItem[]>([]);

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const progressRef = useRef({ done: 0, total: 1 });

  // Web content has no installable file: only a link is possible.
  const effectiveMode: SourceMode = platform === "WEB" ? "link" : sourceMode;
  const fileAccept = platform === "ANDROID" ? ".apk" : GAME_FILE_ACCEPT;

  // Release local preview URLs when the page goes away.
  const previews = useRef<Set<string>>(new Set());
  useEffect(() => {
    const store = previews.current;
    return () => store.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function makePreview(file: File) {
    const url = URL.createObjectURL(file);
    previews.current.add(url);
    return url;
  }

  function resetForm() {
    setEditing(null);
    setType("game");
    setPlatform("ANDROID");
    setIsMod(false);
    setName("");
    setDescription("");
    setPublished(true);
    setSourceMode("upload");
    setApkFile(null);
    setLinkUrl("");
    setExistingSource(null);
    setMainImage(null);
    setScreenshots([]);
    formRef.current?.reset();
  }

  async function startEdit(item: ContentListItem) {
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/content/${item.type}/${item.id}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error ?? "NOT_FOUND");
      const data = payload.data as ContentFormData;

      resetForm();
      setEditing({ type: data.type, id: data.id });
      setType(data.type);
      setPlatform(data.platform);
      setIsMod(data.isMod);
      setName(data.name);
      setDescription(data.description);
      setPublished(data.published);
      setExistingSource(data.source);
      if (data.source) {
        setSourceMode(data.source.mode);
        if (data.source.mode === "link") setLinkUrl(data.source.url);
      }
      setMainImage(data.mainImage ? { key: newKey(), url: data.mainImage, preview: data.mainImage } : null);
      setScreenshots(data.screenshots.map((url) => ({ key: newKey(), url, preview: url })));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      setError(errorText(err instanceof Error ? err.message : null));
    }
  }

  function pickImage(file: File | undefined): string | null {
    if (!file) return null;
    if (!(COVER_CONTENT_TYPES as readonly string[]).includes(file.type)) return "الصور المسموحة: JPG, PNG, WEBP, AVIF.";
    if (file.size > MAX_COVER_FILE_SIZE) return `حجم الصورة أكبر من ${formatBytes(MAX_COVER_FILE_SIZE)}.`;
    return null;
  }

  function onMainImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    const problem = pickImage(file);
    if (problem) return setError(problem);
    if (!file) return;
    setError(null);
    setMainImage({ key: newKey(), file, preview: makePreview(file) });
  }

  function onScreenshots(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    for (const file of files) {
      const problem = pickImage(file);
      if (problem) return setError(problem);
    }
    if (screenshots.length + files.length > MAX_SCREENSHOTS) {
      return setError(`الحد الأقصى ${MAX_SCREENSHOTS} صورة تعريفية.`);
    }
    setError(null);
    setScreenshots((current) => [...current, ...files.map((file) => ({ key: newKey(), file, preview: makePreview(file) }))]);
  }

  function onApkFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return setApkFile(null);
    if (platform === "ANDROID" && !file.name.toLowerCase().endsWith(".apk")) {
      event.target.value = "";
      return setError("اختر ملف بصيغة APK.");
    }
    if (!hasAllowedGameExtension(file.name)) {
      event.target.value = "";
      return setError("صيغة الملف غير مدعومة.");
    }
    if (file.size <= 0 || file.size > MAX_GAME_FILE_SIZE) {
      event.target.value = "";
      return setError("حجم الملف غير مناسب.");
    }
    setError(null);
    setApkFile(file);
  }

  async function uploadOne(file: File, kind: UploadKind) {
    const isImage = kind === "cover";
    const blob = await upload(buildBlobPathname(kind, file.name, crypto.randomUUID()), file, {
      access: "public",
      handleUploadUrl: "/api/admin/content/upload",
      multipart: !isImage,
      ...(isImage ? {} : { contentType: gameContentTypeFor(file.name) }),
      clientPayload: JSON.stringify({
        kind,
        platform,
        size: file.size,
        mimeType: isImage ? file.type : gameContentTypeFor(file.name),
      }),
      onUploadProgress(event) {
        const { done, total } = progressRef.current;
        const value = Math.min(99, Math.round(((done + (file.size * event.percentage) / 100) / total) * 100));
        setProgress((current) => Math.max(current, value));
      },
    });
    progressRef.current.done += file.size;
    return blob.url;
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setMessage(null);

    if (!name.trim()) return setError(ERRORS.NAME_REQUIRED);

    let linkValue = "";
    if (effectiveMode === "link") {
      const normalized = normalizeExternalSourceUrl(linkUrl);
      if (!normalized) return setError(ERRORS.INVALID_APK_LINK);
      linkValue = normalized;
    } else if (!apkFile && existingSource?.mode !== "upload") {
      return setError(ERRORS.SOURCE_REQUIRED);
    }

    const pending: { file: File; kind: UploadKind }[] = [];
    if (effectiveMode === "upload" && apkFile) pending.push({ file: apkFile, kind: "game" });
    if (mainImage?.file) pending.push({ file: mainImage.file, kind: "cover" });
    for (const shot of screenshots) if (shot.file) pending.push({ file: shot.file, kind: "cover" });

    setBusy(true);
    setProgress(0);
    progressRef.current = { done: 0, total: Math.max(1, pending.reduce((sum, item) => sum + item.file.size, 0)) };
    const uploadedNow: string[] = [];

    try {
      let sourceUrl = "";
      if (effectiveMode === "link") {
        sourceUrl = linkValue;
      } else if (apkFile) {
        setMessage("جاري رفع ملف APK...");
        sourceUrl = await uploadOne(apkFile, "game");
        uploadedNow.push(sourceUrl);
      } else if (existingSource?.mode === "upload") {
        sourceUrl = existingSource.url;
      }

      let mainUrl: string | null = null;
      if (mainImage) {
        if (mainImage.file) {
          setMessage("جاري رفع الصورة الرئيسية...");
          const uploadedMain = await uploadOne(mainImage.file, "cover");
          uploadedNow.push(uploadedMain);
          mainUrl = uploadedMain;
        } else {
          mainUrl = mainImage.url ?? null;
        }
      }

      const shotUrls: string[] = [];
      for (const shot of screenshots) {
        if (shot.file) {
          setMessage("جاري رفع الصور التعريفية...");
          const url = await uploadOne(shot.file, "cover");
          uploadedNow.push(url);
          shotUrls.push(url);
        } else if (shot.url) {
          shotUrls.push(shot.url);
        }
      }

      setMessage("جاري الحفظ...");
      const response = await fetch(editing ? `/api/admin/content/${editing.type}/${editing.id}` : "/api/admin/content", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          name: name.trim(),
          description: description.trim(),
          platform,
          isMod,
          published,
          mainImage: mainUrl,
          screenshots: shotUrls,
          source: { mode: effectiveMode, url: sourceUrl },
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(typeof payload?.error === "string" ? payload.error : "FAILED");

      setProgress(100);
      const wasEditing = Boolean(editing);
      resetForm();
      setMessage(wasEditing ? "تم حفظ التعديلات." : "تمت الإضافة بنجاح.");
      router.refresh();
    } catch (err) {
      // Remove files uploaded by this attempt so failed saves leave nothing behind.
      if (uploadedNow.length) {
        try {
          await fetch("/api/admin/content/upload", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urls: uploadedNow }),
          });
        } catch {
          // best effort
        }
      }
      setMessage(null);
      setError(errorText(err instanceof Error ? err.message : null));
    } finally {
      setBusy(false);
    }
  }

  const box = { display: "grid", gap: 8 } as const;
  const choiceRow = { display: "flex", gap: 8, flexWrap: "wrap" } as const;

  return (
    <>
      <section className="glass card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>{editing ? "تعديل المحتوى" : "إضافة لعبة / تطبيق"}</h2>
          {editing && (
            <button type="button" className="btn secondary" onClick={resetForm} disabled={busy}>
              إلغاء التعديل
            </button>
          )}
        </div>

        <form ref={formRef} onSubmit={onSubmit} style={{ display: "grid", gap: 18, marginTop: 18 }}>
          <div style={box}>
            <strong>1. نوع المحتوى</strong>
            <div style={choiceRow}>
              {([["game", "لعبة"], ["app", "تطبيق"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={type === value ? "btn" : "btn secondary"}
                  aria-pressed={type === value}
                  disabled={Boolean(editing) || busy}
                  onClick={() => setType(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label style={box}>
            <strong>2. المنصة</strong>
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} disabled={busy}>
              {UPLOAD_PLATFORM_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <div style={box}>
            <strong>3. نوع النسخة</strong>
            <div style={choiceRow}>
              {([[false, "عادي"], [true, "MOD"]] as const).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  className={isMod === value ? "btn" : "btn secondary"}
                  aria-pressed={isMod === value}
                  disabled={busy}
                  onClick={() => setIsMod(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label style={box}>
            <strong>4. الاسم</strong>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} required disabled={busy} />
          </label>

          <div style={box}>
            <strong>5. {platform === "ANDROID" ? "مصدر APK" : "مصدر التحميل"}</strong>
            {platform !== "WEB" && (
              <div style={choiceRow}>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="radio" name="source-mode" checked={effectiveMode === "upload"} onChange={() => setSourceMode("upload")} disabled={busy} />
                  رفع {platform === "ANDROID" ? "APK" : "ملف"} من الجهاز
                </label>
                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="radio" name="source-mode" checked={effectiveMode === "link"} onChange={() => setSourceMode("link")} disabled={busy} />
                  رابط {platform === "ANDROID" ? "APK" : "التحميل"}
                </label>
              </div>
            )}
            {effectiveMode === "upload" ? (
              <>
                <input type="file" accept={fileAccept} onChange={onApkFile} disabled={busy} />
                {apkFile && <small className="muted">{apkFile.name} · {formatBytes(apkFile.size)}</small>}
                {!apkFile && existingSource?.mode === "upload" && <small className="muted">الملف الحالي محفوظ. اختر ملفًا جديدًا فقط إذا أردت تغييره.</small>}
              </>
            ) : (
              <input
                type="url"
                inputMode="url"
                dir="ltr"
                placeholder="https://..."
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                disabled={busy}
              />
            )}
          </div>

          <div style={box}>
            <strong>6. الصورة الرئيسية</strong>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={onMainImage} disabled={busy} />
            {mainImage && (
              <Thumb src={mainImage.preview} onRemove={() => setMainImage(null)} disabled={busy} size={120} />
            )}
          </div>

          <div style={box}>
            <strong>7. الصور التعريفية</strong>
            <label className="btn secondary" style={{ width: "fit-content", cursor: "pointer" }}>
              + إضافة صورة
              <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/avif" onChange={onScreenshots} disabled={busy} style={{ display: "none" }} />
            </label>
            {screenshots.length > 0 && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {screenshots.map((shot) => (
                  <Thumb
                    key={shot.key}
                    src={shot.preview}
                    size={96}
                    disabled={busy}
                    onRemove={() => setScreenshots((current) => current.filter((item) => item.key !== shot.key))}
                  />
                ))}
              </div>
            )}
          </div>

          <label style={box}>
            <strong>8. الشرح</strong>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={8} maxLength={8000} disabled={busy} />
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} disabled={busy} />
            نشر في الموقع
          </label>

          {busy && <progress value={progress} max={100} />}
          {message && <p role="status" style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(34,197,94,.12)", margin: 0 }}>{message}</p>}
          {error && <p role="alert" style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(239,68,68,.12)", margin: 0 }}>{error}</p>}

          <button className="btn" type="submit" disabled={busy}>
            {busy ? `جاري العمل... ${progress}%` : editing ? "حفظ التعديلات" : "حفظ / إضافة"}
          </button>
        </form>
      </section>

      <section className="glass card">
        <h2 style={{ marginTop: 0 }}>المحتوى الحالي</h2>
        {!items.length && <p className="muted">لا يوجد محتوى بعد.</p>}
        <div style={{ display: "grid", gap: 10 }}>
          {items.map((item) => (
            <article key={`${item.type}-${item.id}`} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              {item.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.image} alt="" width={48} height={48} style={{ objectFit: "cover", borderRadius: 10 }} />
              ) : (
                <span style={{ width: 48, height: 48, borderRadius: 10, background: "rgba(255,255,255,.08)" }} />
              )}
              <div style={{ flex: 1, minWidth: 160 }}>
                <strong>{item.name}</strong>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                  <span className="badge">{item.type === "game" ? "لعبة" : "تطبيق"}</span>
                  {item.platform && <span className="badge">{item.platform}</span>}
                  {item.isMod && <span className="badge">MOD</span>}
                  <span className="badge">{item.published ? "منشور" : "مخفي"}</span>
                </div>
              </div>
              <a className="btn secondary" href={`/${item.type === "game" ? "games" : "apps"}/${item.slug}`} target="_blank" rel="noreferrer">
                فتح
              </a>
              <button type="button" className="btn" onClick={() => startEdit(item)} disabled={busy}>
                تعديل
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function Thumb({ src, size, onRemove, disabled }: { src: string; size: number; onRemove: () => void; disabled: boolean }) {
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 12 }} />
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label="حذف الصورة"
        style={{ position: "absolute", top: 4, insetInlineEnd: 4, width: 26, height: 26, borderRadius: 13, border: 0, cursor: "pointer", background: "rgba(0,0,0,.7)", color: "#fff" }}
      >
        ×
      </button>
    </div>
  );
}
