"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_UPLOAD_SOURCE_STATUS,
  gameContentTypeFor,
  GAME_FILE_ACCEPT,
  MAX_GAMES_PER_BATCH,
  UPLOAD_CONCURRENCY,
  UPLOAD_PLATFORM_OPTIONS,
  buildBlobPathname,
  checkGameFile,
  dedupeSlugs,
  formatBytes,
  platformFromFileName,
  slugify,
  titleFromFileName,
  type UploadPlatform,
} from "@/lib/game-upload-shared";

type Category = { id: string; nameAr: string; nameEn: string };
type Props = { categories: Category[] };

type ItemStatus = "waiting" | "uploading" | "uploaded" | "processing" | "completed" | "failed";

type Item = {
  id: string;
  fileKey: string;
  file: File;
  titleAr: string;
  titleEn: string;
  slug: string;
  platform: UploadPlatform;
  progress: number;
  status: ItemStatus;
  /** Blob URL once the file is uploaded. */
  url?: string;
  error?: string;
};

type BulkResponse = {
  success?: boolean;
  count?: number;
  error?: string;
  detail?: { index?: number; slug?: string; slugs?: string[] };
};

const STATUS_LABEL: Record<ItemStatus, string> = {
  waiting: "بالانتظار",
  uploading: "جاري الرفع",
  uploaded: "تم الرفع · بانتظار الإنشاء",
  processing: "جاري المعالجة",
  completed: "مكتمل",
  failed: "فشل",
};

const ERROR_MESSAGES: Record<string, string> = {
  SLUG_DUPLICATE_IN_BATCH: "يوجد Slug مكرر داخل الدفعة",
  SLUG_ALREADY_EXISTS: "الـ Slug موجود مسبقاً في قاعدة البيانات",
  DOWNLOAD_SOURCE_ALREADY_USED: "هذا الملف مستخدم في لعبة أخرى",
  DUPLICATE_DOWNLOAD_SOURCE_IN_BATCH: "نفس الملف مكرر داخل الدفعة",
  INVALID_GAME: "بيانات اللعبة ناقصة",
  INVALID_PLATFORM: "المنصة غير صالحة",
  INVALID_DOWNLOAD_SOURCE: "رابط الملف غير صالح",
  INVALID_BATCH_SIZE: "عدد الألعاب في الدفعة غير مسموح",
  BULK_CREATE_FAILED: "فشل إنشاء الألعاب في قاعدة البيانات، تم حذف الملفات المرفوعة. أعد المحاولة.",
  Unauthorized: "انتهت الجلسة، سجّل الدخول من جديد",
  Forbidden: "هذه العملية متاحة لـ SUPER_ADMIN فقط",
};

function describeError(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  return ERROR_MESSAGES[code] ?? code;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "UPLOAD_FAILED";
}

function fileKeyOf(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export default function BulkGameUploadForm({ categories }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef<Item[]>([]);
  const stopRef = useRef(false);

  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [price, setPrice] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [published, setPublished] = useState(true);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function commit(next: Item[]) {
    itemsRef.current = next;
    setItems(next);
  }

  function patch(id: string, changes: Partial<Item>) {
    commit(itemsRef.current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }

  const stats = useMemo(() => {
    const total = items.length;
    const uploadedCount = items.filter((i) => i.status === "uploaded" || i.status === "processing" || i.status === "completed").length;
    const completedCount = items.filter((i) => i.status === "completed").length;
    const failedCount = items.filter((i) => i.status === "failed").length;
    const pendingCreate = items.filter((i) => i.status === "uploaded").length;
    const totalBytes = items.reduce((sum, i) => sum + i.file.size, 0);
    const doneBytes = items.reduce((sum, i) => {
      const done = i.status === "uploaded" || i.status === "processing" || i.status === "completed" ? 100 : i.progress;
      return sum + (i.file.size * done) / 100;
    }, 0);
    const percent = totalBytes ? Math.min(100, Math.round((doneBytes / totalBytes) * 100)) : 0;
    return { total, uploadedCount, completedCount, failedCount, pendingCreate, percent };
  }, [items]);

  // Warn before leaving while files are in flight or uploaded but not yet turned into games.
  const hasUnsavedWork = busy || stats.pendingCreate > 0;
  useEffect(() => {
    if (!hasUnsavedWork) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedWork]);

  function resetInput() {
    const input = document.getElementById("bulk-game-file-input") as HTMLInputElement | null;
    if (input) input.value = "";
  }

  function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    resetInput();
    setError(null);
    setStatus(null);
    if (!files.length) return;

    const known = new Set(itemsRef.current.map((item) => item.fileKey));
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const file of files) {
      const key = fileKeyOf(file);
      if (known.has(key)) continue;
      const issue = checkGameFile(file);
      if (issue) {
        rejected.push(`${file.name} (${issue === "UNSUPPORTED_EXTENSION" ? "صيغة غير مدعومة" : issue === "EMPTY_FILE" ? "ملف فارغ" : "حجم كبير جداً"})`);
        continue;
      }
      known.add(key);
      accepted.push(file);
    }

    const room = MAX_GAMES_PER_BATCH - itemsRef.current.length;
    const kept = accepted.slice(0, Math.max(0, room));
    const overflow = accepted.length - kept.length;

    const taken = new Set(itemsRef.current.map((item) => item.slug));
    const slugs = dedupeSlugs(kept.map((file) => slugify(titleFromFileName(file.name))), taken);
    const added: Item[] = kept.map((file, index) => {
      const title = titleFromFileName(file.name);
      return {
        id: crypto.randomUUID(),
        fileKey: fileKeyOf(file),
        file,
        titleAr: title,
        titleEn: title,
        slug: slugs[index] ?? `game-${index + 1}`,
        platform: platformFromFileName(file.name),
        progress: 0,
        status: "waiting",
      };
    });
    commit([...itemsRef.current, ...added]);

    const notes: string[] = [];
    if (rejected.length) notes.push("تم تجاهل: " + rejected.join("، "));
    if (overflow > 0) notes.push(`الحد الأقصى ${MAX_GAMES_PER_BATCH} لعبة في الدفعة، تم تجاهل ${overflow} ملف.`);
    if (notes.length) setError(notes.join(" — "));
    if (added.length) setStatus(`تمت إضافة ${added.length} لعبة. راجع الأسماء والمنصات ثم اضغط «بدء الرفع».`);
  }

  async function cleanupRemote(urls: string[]) {
    const unique = Array.from(new Set(urls.filter(Boolean)));
    if (!unique.length) return;
    try {
      await fetch("/api/admin/games/upload", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: unique }),
      });
    } catch {
      // best effort
    }
  }

  async function uploadItem(id: string) {
    const item = itemsRef.current.find((row) => row.id === id);
    if (!item) return;
    patch(id, { status: "uploading", progress: 0, error: undefined });
    let lastPercent = -1;
    try {
      const blob = await upload(buildBlobPathname("game", item.file.name, crypto.randomUUID()), item.file, {
        access: "public",
        handleUploadUrl: "/api/admin/games/upload",
        multipart: true,
        contentType: gameContentTypeFor(item.file.name),
        clientPayload: JSON.stringify({ kind: "game", mimeType: gameContentTypeFor(item.file.name), size: item.file.size }),
        onUploadProgress(event) {
          const value = Math.max(0, Math.min(99, Math.floor(event.percentage)));
          if (value === lastPercent) return; // avoid re-rendering 100 rows on every chunk
          lastPercent = value;
          patch(id, { progress: value });
        },
      });
      patch(id, { status: "uploaded", progress: 100, url: blob.url });
    } catch (uploadError) {
      patch(id, { status: "failed", error: errorText(uploadError), url: undefined });
    }
  }

  /** Real queue: always keeps UPLOAD_CONCURRENCY uploads running; a finished slot immediately starts the next file. */
  async function runQueue(ids: string[]) {
    let cursor = 0;
    async function worker() {
      for (;;) {
        if (stopRef.current) return;
        const id = ids[cursor];
        cursor += 1;
        if (id === undefined) return;
        await uploadItem(id);
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, ids.length) }, () => worker()));
  }

  function validateItems(targets: Item[]): string | null {
    const seen = new Set<string>();
    for (const item of itemsRef.current) {
      if (item.status === "completed") seen.add(item.slug);
    }
    for (const item of targets) {
      const slug = slugify(item.slug);
      if (!item.titleAr.trim() || !item.titleEn.trim() || !slug) return `راجع بيانات: ${item.file.name}`;
      if (seen.has(slug)) return `يوجد Slug مكرر: ${slug}`;
      seen.add(slug);
    }
    return null;
  }

  async function checkSlugsRemote(targets: Item[]): Promise<string[] | null> {
    try {
      const response = await fetch("/api/admin/games/slug-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slugs: targets.map((item) => slugify(item.slug)) }),
      });
      const payload = (await response.json().catch(() => null)) as { success?: boolean; taken?: string[]; error?: string } | null;
      if (!response.ok || !payload?.success) throw new Error(describeError(payload?.error, "تعذر فحص الـ Slug"));
      return payload.taken ?? [];
    } catch (checkError) {
      setError(errorText(checkError));
      return null;
    }
  }

  async function createGames(ids: string[]) {
    const targets = itemsRef.current.filter((item) => ids.includes(item.id) && item.url);
    if (!targets.length) return;

    for (const item of targets) patch(item.id, { status: "processing", error: undefined });
    setStatus(`جاري إنشاء ${targets.length} لعبة في قاعدة البيانات...`);

    const priceNumber = Number(price);
    const discountNumber = Number(discount);
    try {
      const response = await fetch("/api/admin/games/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          games: targets.map((item) => ({
            titleAr: item.titleAr.trim(),
            titleEn: item.titleEn.trim(),
            slug: slugify(item.slug),
            platforms: [item.platform],
            categoryIds,
            price: Number.isFinite(priceNumber) ? Math.max(0, priceNumber) : 0,
            discount: Number.isFinite(discountNumber) ? Math.min(100, Math.max(0, discountNumber)) : 0,
            downloadSource: item.url,
            sourceStatus: DEFAULT_UPLOAD_SOURCE_STATUS,
            published,
            featured: false,
          })),
        }),
      });
      const payload = (await response.json().catch(() => null)) as BulkResponse | null;

      if (response.ok && payload?.success) {
        for (const item of targets) patch(item.id, { status: "completed", progress: 100 });
        setStatus(`تم إنشاء ${payload.count ?? targets.length} لعبة بنجاح.`);
        router.refresh();
        return;
      }

      const message = describeError(payload?.error, "تعذر إنشاء الألعاب.");
      const slugs = payload?.detail?.slugs ?? (payload?.detail?.slug ? [payload.detail.slug] : []);
      if (payload?.error === "BULK_CREATE_FAILED") {
        // The server rolled back and deleted this batch's files: the uploads must be repeated.
        for (const item of targets) patch(item.id, { status: "failed", progress: 0, url: undefined, error: message });
      } else {
        // Nothing was written and the files are still in Blob: keep them so the slug can be fixed and retried.
        for (const item of targets) {
          const conflict = slugs.includes(slugify(item.slug));
          patch(item.id, { status: "uploaded", error: conflict ? message : undefined });
        }
      }
      setError(slugs.length ? `${message}: ${slugs.join("، ")}` : message);
    } catch (createError) {
      for (const item of targets) patch(item.id, { status: "uploaded" });
      setError(`${errorText(createError)} — الملفات ما زالت مرفوعة، اضغط «إنشاء الألعاب المرفوعة» للمحاولة من جديد.`);
    }
  }

  async function startUpload() {
    setError(null);
    setStatus(null);
    const targets = itemsRef.current.filter((item) => item.status === "waiting" || item.status === "failed");
    if (!itemsRef.current.length) return setError("حدد ملفات الألعاب أولاً.");
    if (!rights) return setError("يجب تأكيد أن لديك حق توزيع ملفات الألعاب.");
    if (!targets.length) return setError("لا توجد ملفات بانتظار الرفع.");

    const validation = validateItems(itemsRef.current.filter((item) => item.status !== "completed"));
    if (validation) return setError(validation);

    setBusy(true);
    stopRef.current = false;
    try {
      const taken = await checkSlugsRemote(targets);
      if (taken === null) return;
      if (taken.length) {
        for (const item of targets) {
          if (taken.includes(slugify(item.slug))) patch(item.id, { error: "هذا الـ Slug موجود مسبقاً" });
        }
        return setError(`Slug موجود مسبقاً: ${taken.join("، ")}. عدّله ثم أعد المحاولة.`);
      }

      setStatus(`جاري رفع ${targets.length} لعبة (${UPLOAD_CONCURRENCY} بالتوازي)...`);
      await runQueue(targets.map((item) => item.id));

      const failed = itemsRef.current.filter((item) => item.status === "failed").length;
      const ready = itemsRef.current.filter((item) => item.status === "uploaded").map((item) => item.id);
      if (failed > 0) {
        setError(`فشل رفع ${failed} ملف. يمكنك إعادة محاولة الفاشلة فقط، أو إنشاء الألعاب التي رُفعت بنجاح.`);
        setStatus(null);
        return;
      }
      if (ready.length) await createGames(ready);
    } finally {
      setBusy(false);
    }
  }

  async function createUploadedOnly() {
    setError(null);
    const ids = itemsRef.current.filter((item) => item.status === "uploaded").map((item) => item.id);
    const validation = validateItems(itemsRef.current.filter((item) => item.status === "uploaded"));
    if (validation) return setError(validation);
    setBusy(true);
    try {
      await createGames(ids);
    } finally {
      setBusy(false);
    }
  }

  async function discardUploaded() {
    const urls = itemsRef.current.filter((item) => item.status === "uploaded" && item.url).map((item) => item.url as string);
    setBusy(true);
    try {
      await cleanupRemote(urls);
      commit(itemsRef.current.filter((item) => item.status === "completed"));
      setStatus("تم حذف الملفات المرفوعة التي لم تُنشأ لها ألعاب.");
    } finally {
      setBusy(false);
    }
  }

  function removeItem(id: string) {
    commit(itemsRef.current.filter((item) => item.id !== id));
  }

  function clearFinished() {
    commit(itemsRef.current.filter((item) => item.status !== "completed"));
    setStatus(null);
  }

  const editable = (item: Item) => !busy && (item.status === "waiting" || item.status === "failed" || item.status === "uploaded");
  const canStart = !busy && items.some((item) => item.status === "waiting" || item.status === "failed");

  return (
    <section className="glass card" style={{ marginBottom: 20 }}>
      <span className="badge">BULK UPLOAD</span>
      <h2 style={{ marginBottom: 6 }}>رفع عدة ألعاب دفعة واحدة</h2>
      <p className="muted" style={{ margin: 0 }}>
        حدد حتى {MAX_GAMES_PER_BATCH} لعبة من الهاتف أو الكمبيوتر. الملفات تُرفع مباشرة إلى Vercel Blob ({UPLOAD_CONCURRENCY} بالتوازي)، ثم تُنشأ لعبة مستقلة لكل ملف.
      </p>

      <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
        <div className="glass card" style={{ display: "grid", gap: 10 }}>
          <label>
            اختيار ملفات الألعاب *
            <input
              id="bulk-game-file-input"
              type="file"
              multiple
              disabled={busy}
              accept={GAME_FILE_ACCEPT}
              onChange={choose}
              style={{ width: "100%", minHeight: 44 }}
            />
          </label>
          <small className="muted">عدد الملفات: {items.length} / {MAX_GAMES_PER_BATCH}</small>
        </div>

        {items.length > 0 && (
          <>
            <div className="glass card" style={{ display: "grid", gap: 12 }}>
              <strong>إعدادات الدفعة (تُطبق على كل الألعاب)</strong>
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
                <label>
                  السعر بالدولار
                  <input type="number" inputMode="decimal" min="0" step="0.01" value={price} disabled={busy} onChange={(e) => setPrice(e.target.value)} />
                </label>
                <label>
                  الخصم %
                  <input type="number" inputMode="numeric" min="0" max="100" step="1" value={discount} disabled={busy} onChange={(e) => setDiscount(e.target.value)} />
                </label>
              </div>
              {categories.length > 0 && (
                <div>
                  <strong>الفئات</strong>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                    {categories.map((category) => {
                      const active = categoryIds.includes(category.id);
                      return (
                        <button
                          key={category.id}
                          type="button"
                          disabled={busy}
                          className={active ? "btn" : "btn secondary"}
                          aria-pressed={active}
                          onClick={() => setCategoryIds(active ? categoryIds.filter((id) => id !== category.id) : [...categoryIds, category.id])}
                        >
                          {category.nameAr}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={published} disabled={busy} onChange={(e) => setPublished(e.target.checked)} />
                نشر جميع الألعاب بعد الإنشاء
              </label>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <strong>الألعاب المحددة: {items.length}</strong>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {stats.completedCount > 0 && (
                  <button type="button" className="btn secondary" disabled={busy} onClick={clearFinished}>مسح المكتمل</button>
                )}
                {stats.pendingCreate > 0 && (
                  <button type="button" className="btn secondary" disabled={busy} onClick={discardUploaded}>حذف الملفات المرفوعة</button>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {items.map((item, index) => (
                <div key={item.id} className="glass card" style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                    <strong style={{ wordBreak: "break-all" }}>{index + 1}. {item.file.name}</strong>
                    {(item.status === "waiting" || item.status === "failed") && !busy && (
                      <button type="button" className="btn secondary" onClick={() => removeItem(item.id)} aria-label="إزالة">✕</button>
                    )}
                  </div>
                  <small className="muted">
                    {formatBytes(item.file.size)} · {STATUS_LABEL[item.status]}
                    {item.status === "uploading" ? ` ${item.progress}%` : ""}
                  </small>
                  <progress value={item.status === "uploaded" || item.status === "processing" || item.status === "completed" ? 100 : item.progress} max={100} style={{ width: "100%" }} />
                  <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
                    <label>الاسم بالعربية<input value={item.titleAr} disabled={!editable(item)} onChange={(e) => patch(item.id, { titleAr: e.target.value })} /></label>
                    <label>الاسم بالإنجليزية<input value={item.titleEn} disabled={!editable(item)} onChange={(e) => patch(item.id, { titleEn: e.target.value })} /></label>
                    <label>Slug<input value={item.slug} disabled={!editable(item)} onChange={(e) => patch(item.id, { slug: slugify(e.target.value) })} /></label>
                    <label>
                      المنصة
                      <select value={item.platform} disabled={!editable(item)} onChange={(e) => patch(item.id, { platform: (UPLOAD_PLATFORM_OPTIONS.find(([value]) => value === e.target.value)?.[0]) ?? item.platform })}>
                        {UPLOAD_PLATFORM_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                  </div>
                  {item.error && <small style={{ color: "crimson" }}>{item.error}</small>}
                </div>
              ))}
            </div>

            <div className="glass card" style={{ display: "grid", gap: 8 }}>
              <strong>التقدم الإجمالي</strong>
              <progress value={stats.percent} max={100} style={{ width: "100%" }} />
              <small>رُفع {stats.uploadedCount} / {stats.total} · {stats.percent}%{stats.completedCount ? ` · أُنشئ ${stats.completedCount}` : ""}{stats.failedCount ? ` · فشل ${stats.failedCount}` : ""}</small>
            </div>
          </>
        )}

        <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <input type="checkbox" checked={rights} disabled={busy} onChange={(e) => setRights(e.target.checked)} />
          أؤكد أن ملفات الألعاب مملوكة لي أو لدي ترخيص/حق قانوني لتوزيعها على GameVortex.
        </label>

        {status && <p style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(34,197,94,.12)" }}>{status}</p>}
        {error && <p style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(239,68,68,.12)" }}>{error}</p>}

        <div style={{ display: "grid", gap: 8 }}>
          <button className="btn" type="button" onClick={startUpload} disabled={!canStart}>
            {busy ? `جاري العمل... ${stats.percent}%` : stats.failedCount > 0 ? `إعادة محاولة الفاشلة (${stats.failedCount})` : `بدء الرفع (${items.filter((i) => i.status === "waiting").length})`}
          </button>
          {!busy && stats.pendingCreate > 0 && stats.failedCount > 0 && (
            <button className="btn secondary" type="button" onClick={createUploadedOnly}>
              إنشاء الألعاب المرفوعة ({stats.pendingCreate})
            </button>
          )}
          {!busy && stats.pendingCreate > 0 && stats.failedCount === 0 && !items.some((i) => i.status === "waiting") && (
            <button className="btn secondary" type="button" onClick={createUploadedOnly}>
              إنشاء الألعاب المرفوعة ({stats.pendingCreate})
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
