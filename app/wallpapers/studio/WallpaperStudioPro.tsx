"use client";

import Link from "next/link";
import { useCallback, useEffect, useReducer, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  STUDIO_ADHKAR,
  STUDIO_EFFECTS,
  STUDIO_EFFECT_KEYS,
  STUDIO_FONTS,
  STUDIO_FONT_KEYS,
  STUDIO_H,
  STUDIO_MAX_LAYERS,
  STUDIO_PHRASES,
  STUDIO_W,
  listVipFeatures,
  saveLimitFor,
  studioDocumentSchema,
  type StudioBackground,
  type StudioDocument,
  type StudioEffectKey,
  type StudioLayer,
  type StudioTemplateId,
} from "@/lib/wallpaper-studio-policy";
import { drawScene, drawSelection, hitLayer, isAutoKind, resolveLayerText } from "./studio-render";
import { STUDIO_TEMPLATES, buildTemplateDocument, getTemplate, makeLayer, uid } from "./studio-templates";
import {
  LOCAL_IMAGE_MAX_COUNT,
  StudioImageError,
  deleteLocalImage,
  getLocalImage,
  listLocalImages,
  prepareImageFile,
  putLocalImage,
  readLocalDesigns,
  writeLocalDesigns,
  type LocalDesign,
} from "./studio-storage";

/* -------------------------------------------------------------------------- */
/* الأنواع                                                                     */
/* -------------------------------------------------------------------------- */

export type StudioAccessProps = { loggedIn: boolean; isVip: boolean; isOwner: boolean };
type DocState = Pick<StudioDocument, "templateId" | "effect" | "target" | "layers">;
type Tab = "background" | "templates" | "text" | "layers" | "effects" | "designs";
type Status = { text: string; tone: "ok" | "error"; link?: { href: string; label: string } } | null;
type LibraryItem = { id: string; title: string; category: string; isVip: boolean; locked: boolean; thumb: string | null; src: string | null };
type ServerDesignRow = { id: string; name: string; tier: string; updatedAt: string };
type CurrentDesign = { kind: "server" | "local"; id: string } | null;

const TAB_LABELS: [Tab, string][] = [
  ["background", "الخلفية"],
  ["templates", "القوالب"],
  ["text", "النصوص"],
  ["layers", "الطبقات"],
  ["effects", "التأثيرات"],
  ["designs", "تصميماتي"],
];

const CATEGORY_LABELS: Record<string, string> = {
  GAMING: "Gaming", CYBERPUNK: "Cyberpunk", SCI_FI: "Sci-Fi", FANTASY: "Fantasy", ABSTRACT: "Abstract", NATURE: "طبيعة",
  ANIME: "Anime", MINIMAL: "Minimal", SPACE: "فضاء", NEON: "Neon", GAMEVORTEX: "GameVortex", OTHER: "أخرى",
};

const VIP_LINK = { href: "/vip", label: "اشترك في VIP" };

function toDocument(doc: DocState): StudioDocument {
  return { v: 1, templateId: doc.templateId, effect: doc.effect, target: doc.target, layers: doc.layers };
}

function describeApiError(code: string | undefined, access: StudioAccessProps): Status {
  switch (code) {
    case "VIP_REQUIRED":
      return { text: "هذه الميزة متاحة لمشتركي VIP فقط.", tone: "error", link: VIP_LINK };
    case "SAVE_LIMIT_REACHED": {
      const limit = saveLimitFor({ isVip: access.isVip, isOwner: access.isOwner });
      return {
        text: `وصلت إلى الحد الأقصى من التصاميم المحفوظة${limit ? ` (${limit})` : ""}. احذف تصميمًا قديمًا${access.isVip ? "" : " أو اشترك في VIP لحد أكبر"}.`,
        tone: "error",
        link: access.isVip ? undefined : VIP_LINK,
      };
    }
    case "UNAUTHORIZED":
      return { text: "سجّل الدخول لحفظ تصميماتك في حسابك.", tone: "error", link: { href: "/auth/login?next=/wallpapers/studio", label: "تسجيل الدخول" } };
    case "DESIGN_NOT_FOUND":
      return { text: "التصميم غير موجود.", tone: "error" };
    case "BACKGROUND_NOT_FOUND":
      return { text: "خلفية التصميم لم تعد متاحة في المكتبة.", tone: "error" };
    case "INVALID_DESIGN":
      return { text: "بيانات التصميم غير صالحة.", tone: "error" };
    default:
      return { text: "تعذر إكمال العملية. حاول مرة أخرى بعد قليل.", tone: "error" };
  }
}

function describeImageError(error: unknown): Status {
  const code = error instanceof StudioImageError ? error.code : undefined;
  const text =
    code === "TOO_LARGE" ? "الصورة أكبر من 15MB. اختر صورة أصغر."
    : code === "UNSUPPORTED_TYPE" || code === "NOT_AN_IMAGE" ? "الملف ليس صورة مدعومة. استخدم PNG أو JPEG أو WebP أو GIF."
    : code === "DECODE_FAILED" ? "تعذر قراءة الصورة. قد تكون تالفة."
    : "تعذر استخدام الصورة.";
  return { text, tone: "error" };
}

/* -------------------------------------------------------------------------- */
/* المكوّن الرئيسي                                                              */
/* -------------------------------------------------------------------------- */

export default function WallpaperStudioPro({ access, categories, initialPlayerName }: { access: StudioAccessProps; categories: string[]; initialPlayerName: string }) {
  const vipOk = access.isVip || access.isOwner;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const multiFileRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<{ source: ImageBitmap; width: number; height: number } | null>(null);
  const sessionBlobs = useRef(new Map<string, Blob>());
  const unpersisted = useRef(new Set<string>());

  const [doc, setDocState] = useState<DocState>(() => buildTemplateDocument("cyber", initialPlayerName));
  const docRef = useRef(doc);
  const past = useRef<DocState[]>([]);
  const future = useRef<DocState[]>([]);
  const lastCoalesce = useRef<{ key: string; t: number } | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const [bg, setBg] = useState<StudioBackground>({ kind: "none" });
  const [bgVersion, setBgVersion] = useState(0);
  const [bgLoading, setBgLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("background");
  const [status, setStatus] = useState<Status>(null);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [exportType, setExportType] = useState<"image/png" | "image/jpeg">("image/png");
  const [playerName, setPlayerName] = useState(initialPlayerName);
  const [customText, setCustomText] = useState("");

  const [designName, setDesignName] = useState("تصميمي");
  const [currentDesign, setCurrentDesign] = useState<CurrentDesign>(null);
  const [serverDesigns, setServerDesigns] = useState<ServerDesignRow[]>([]);
  const [localDesigns, setLocalDesigns] = useState<LocalDesign[]>([]);

  const [localImages, setLocalImages] = useState<{ id: string; url: string }[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [libCursor, setLibCursor] = useState<string | null>(null);
  const [libLoading, setLibLoading] = useState(false);
  const [libError, setLibError] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [category, setCategory] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const libAbort = useRef<AbortController | null>(null);

  const selectedLayer = doc.layers.find((l) => l.id === selectedId) ?? null;
  const vipFeaturesInUse = listVipFeatures(toDocument(doc));
  const lockedByVip = !vipOk && vipFeaturesInUse.length > 0;

  /* ----------------------------- التاريخ (تراجع/إعادة) ----------------------------- */

  function setDoc(next: DocState) {
    docRef.current = next;
    setDocState(next);
  }

  function commit(next: DocState, coalesceKey?: string) {
    const t = Date.now();
    const prev = lastCoalesce.current;
    const merge = coalesceKey !== undefined && prev !== null && prev.key === coalesceKey && t - prev.t < 700;
    if (!merge) past.current = [...past.current.slice(-49), docRef.current];
    lastCoalesce.current = coalesceKey ? { key: coalesceKey, t } : null;
    future.current = [];
    setDoc(next);
    bump();
  }

  function undo() {
    const previous = past.current.at(-1);
    if (!previous) return;
    past.current = past.current.slice(0, -1);
    future.current = [...future.current, docRef.current];
    lastCoalesce.current = null;
    setDoc(previous);
    bump();
  }

  function redo() {
    const next = future.current.at(-1);
    if (!next) return;
    future.current = future.current.slice(0, -1);
    past.current = [...past.current, docRef.current];
    lastCoalesce.current = null;
    setDoc(next);
    bump();
  }

  function resetHistory() {
    past.current = [];
    future.current = [];
    lastCoalesce.current = null;
    bump();
  }

  function updateLayer(id: string, patch: Partial<StudioLayer>, key?: string) {
    const d = docRef.current;
    commit({ ...d, layers: d.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) }, key ? `${id}:${key}` : undefined);
  }

  function addLayer(layer: StudioLayer) {
    const d = docRef.current;
    if (d.layers.length >= STUDIO_MAX_LAYERS) {
      setStatus({ text: `الحد الأقصى ${STUDIO_MAX_LAYERS} طبقة.`, tone: "error" });
      return;
    }
    commit({ ...d, layers: [...d.layers, layer] });
    setSelectedId(layer.id);
  }

  function moveLayer(id: string, to: "front" | "back" | "up" | "down") {
    const d = docRef.current;
    const index = d.layers.findIndex((l) => l.id === id);
    if (index < 0) return;
    const layers = [...d.layers];
    const [item] = layers.splice(index, 1);
    const target = to === "front" ? layers.length : to === "back" ? 0 : to === "up" ? Math.min(layers.length, index + 1) : Math.max(0, index - 1);
    layers.splice(target, 0, item);
    commit({ ...d, layers });
  }

  function removeLayer(id: string) {
    const d = docRef.current;
    commit({ ...d, layers: d.layers.filter((l) => l.id !== id) });
    if (selectedId === id) setSelectedId(null);
  }

  /* ----------------------------- الساعة الحية ----------------------------- */

  useEffect(() => {
    let last = "";
    const tick = () => {
      const d = new Date();
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
      if (key !== last) {
        last = key;
        setNow(d);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  /* ----------------------------- الخلفية ----------------------------- */

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    const replace = (bitmap: ImageBitmap | null) => {
      bgRef.current?.source.close();
      bgRef.current = bitmap ? { source: bitmap, width: bitmap.width, height: bitmap.height } : null;
      setBgVersion((v) => v + 1);
    };
    async function load() {
      if (bg.kind === "none") return replace(null);
      setBgLoading(true);
      try {
        let blob: Blob | null = null;
        if (bg.kind === "library") {
          const res = await fetch(`/api/wallpapers/${encodeURIComponent(bg.wallpaperId)}/media`, { signal: abort.signal });
          if (res.status === 401 || res.status === 403) throw new Error("VIP_REQUIRED");
          if (!res.ok) throw new Error("LOAD_FAILED");
          blob = await res.blob();
        } else {
          blob = sessionBlobs.current.get(bg.localId) ?? (await getLocalImage(bg.localId));
          if (!blob) throw new Error("LOCAL_MISSING");
        }
        const bitmap = await createImageBitmap(blob);
        if (cancelled) return bitmap.close();
        replace(bitmap);
      } catch (error) {
        if (cancelled || (error as Error).name === "AbortError") return;
        replace(null);
        const code = (error as Error).message;
        setStatus(
          code === "VIP_REQUIRED" ? { text: "هذه الخلفية مخصصة لمشتركي VIP.", tone: "error", link: VIP_LINK }
          : code === "LOCAL_MISSING" ? { text: "الصورة الخاصة بهذا التصميم غير موجودة على هذا الجهاز (تُحفظ الصور الخاصة في المتصفح فقط). اختر خلفية جديدة.", tone: "error" }
          : { text: "تعذر تحميل الخلفية. تحقق من الاتصال وحاول مرة أخرى.", tone: "error" },
        );
      } finally {
        if (!cancelled) setBgLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [bg]);

  useEffect(() => () => bgRef.current?.source.close(), []);

  /* ----------------------------- الرسم ----------------------------- */

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      drawScene(ctx, { background: bgRef.current, overlay: getTemplate(doc.templateId).overlay, effect: doc.effect, layers: doc.layers, now });
    });
    return () => cancelAnimationFrame(raf);
  }, [doc, bgVersion, now]);

  useEffect(() => {
    const ctx = overlayRef.current?.getContext("2d");
    if (ctx) drawSelection(ctx, selectedLayer, selectedLayer ? resolveLayerText(selectedLayer, now) : "");
  }, [selectedLayer, now]);

  /* ----------------------------- اللمس والفأرة ----------------------------- */

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ mode: "drag" | "pinch"; id: string; dx: number; dy: number; startDist: number; startAngle: number; startScale: number; startRotation: number; before: DocState; moved: boolean } | null>(null);

  function toCanvasPoint(e: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * STUDIO_W, y: ((e.clientY - rect.top) / rect.height) * STUDIO_H };
  }

  function pickLayer(x: number, y: number): string | null {
    const ctx = overlayRef.current?.getContext("2d");
    if (!ctx) return null;
    const layers = docRef.current.layers;
    for (let i = layers.length - 1; i >= 0; i -= 1) {
      const layer = layers[i];
      if (layer.visible && hitLayer(ctx, layer, resolveLayerText(layer, now), x, y)) return layer.id;
    }
    return null;
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture(e.pointerId);
    const point = toCanvasPoint(e);
    if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      const layer = docRef.current.layers.find((l) => l.id === gesture.current!.id);
      if (layer) {
        gesture.current = { ...gesture.current, mode: "pinch", startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1, startAngle: Math.atan2(b.y - a.y, b.x - a.x), startScale: layer.scale, startRotation: layer.rotation };
      }
      return;
    }
    const hit = pickLayer(point.x, point.y);
    setSelectedId(hit);
    if (hit) {
      const layer = docRef.current.layers.find((l) => l.id === hit)!;
      gesture.current = { mode: "drag", id: hit, dx: point.x - layer.x, dy: point.y - layer.y, startDist: 1, startAngle: 0, startScale: layer.scale, startRotation: layer.rotation, before: docRef.current, moved: false };
    } else {
      gesture.current = null;
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const d = docRef.current;
    if (g.mode === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const scale = Math.min(6, Math.max(0.1, g.startScale * (dist / g.startDist)));
      const rotation = Math.round(((g.startRotation + ((angle - g.startAngle) * 180) / Math.PI + 540) % 360) - 180);
      g.moved = true;
      setDoc({ ...d, layers: d.layers.map((l) => (l.id === g.id ? { ...l, scale, rotation } : l)) });
      return;
    }
    if (g.mode === "drag" && pointers.current.size === 1) {
      const point = toCanvasPoint(e);
      g.moved = true;
      setDoc({ ...d, layers: d.layers.map((l) => (l.id === g.id ? { ...l, x: point.x - g.dx, y: point.y - g.dy } : l)) });
    }
  }

  function onPointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return;
    const g = gesture.current;
    gesture.current = null;
    if (g?.moved) {
      past.current = [...past.current.slice(-49), g.before];
      future.current = [];
      lastCoalesce.current = null;
      bump();
    }
  }

  /* ----------------------------- رفع صورة من الهاتف ----------------------------- */

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const { blob, bitmap } = await prepareImageFile(file);
      bitmap.close();
      let id: string;
      try {
        id = await putLocalImage(blob);
      } catch (error) {
        if ((error as Error).message === "LOCAL_IMAGE_LIMIT") {
          setStatus({ text: `وصلت إلى حد ${LOCAL_IMAGE_MAX_COUNT} صورة محفوظة على الجهاز. احذف بعض صورك أولًا.`, tone: "error" });
          return;
        }
        // التخزين المحلي غير متاح (مثلًا تصفح خاص): نستخدم الصورة في هذه الجلسة فقط.
        id = uid();
        unpersisted.current.add(id);
        setStatus({ text: "تعذر حفظ الصورة على الجهاز؛ ستبقى متاحة حتى إغلاق الصفحة فقط.", tone: "error" });
      }
      sessionBlobs.current.set(id, blob);
      setBg({ kind: "local", localId: id });
      await refreshLocalImages();
      if (!unpersisted.current.has(id)) setStatus({ text: "تم تحميل الصورة وحفظها على جهازك. لا تُنشر في المكتبة العامة.", tone: "ok" });
    } catch (error) {
      setStatus(describeImageError(error));
    } finally {
      setBusy(false);
    }
  }

  const imageUrls = useRef(new Map<string, string>());
  const refreshLocalImages = useCallback(async () => {
    try {
      const rows = await listLocalImages();
      const next: { id: string; url: string }[] = [];
      for (const row of rows) {
        let url = imageUrls.current.get(row.id);
        if (!url) {
          const blob = sessionBlobs.current.get(row.id) ?? (await getLocalImage(row.id));
          if (!blob) continue;
          url = URL.createObjectURL(blob);
          imageUrls.current.set(row.id, url);
        }
        next.push({ id: row.id, url });
      }
      setLocalImages(next);
    } catch {
      setLocalImages([]);
    }
  }, []);

  async function removeLocalImage(id: string) {
    try {
      await deleteLocalImage(id);
      const url = imageUrls.current.get(id);
      if (url) URL.revokeObjectURL(url);
      imageUrls.current.delete(id);
      sessionBlobs.current.delete(id);
      if (bg.kind === "local" && bg.localId === id) setBg({ kind: "none" });
      await refreshLocalImages();
    } catch {
      setStatus({ text: "تعذر حذف الصورة.", tone: "error" });
    }
  }

  useEffect(() => {
    void refreshLocalImages();
    const urls = imageUrls.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [refreshLocalImages]);

  /**
   * دمج عدة صور محليًا قبل إرسال المشهد المركّب إلى خدمة تحرير الصور الحالية.
   * لا ننشئ صورة بديلة من الصفر: الصور الأصلية تدخل في لوحة واحدة أولًا.
   */
  async function onUploadMultiple(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    if (files.length < 2) {
      setStatus({ text: "اختر صورتين أو أكثر لدمجها في مشهد واحد.", tone: "error" });
      return;
    }
    setBusy(true);
    setStatus({ text: "جارٍ تجهيز الصور ودمجها محليًا…", tone: "ok" });
    const bitmaps: ImageBitmap[] = [];
    try {
      for (const file of files.slice(0, 8)) {
        const prepared = await prepareImageFile(file);
        bitmaps.push(prepared.bitmap);
      }
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1920;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("CANVAS_UNAVAILABLE");

      // الصورة الأولى تشكل المشهد الأساسي، وبقية الصور توضع فوقها كعناصر واضحة.
      const base = bitmaps[0];
      const baseScale = Math.max(canvas.width / base.width, canvas.height / base.height);
      const baseW = base.width * baseScale;
      const baseH = base.height * baseScale;
      ctx.drawImage(base, (canvas.width - baseW) / 2, (canvas.height - baseH) / 2, baseW, baseH);
      ctx.fillStyle = "rgba(4, 8, 20, .18)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = 1; i < bitmaps.length; i += 1) {
        const image = bitmaps[i];
        const maxW = i % 2 === 0 ? 610 : 680;
        const maxH = i % 2 === 0 ? 760 : 620;
        const scale = Math.min(maxW / image.width, maxH / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        const x = i % 2 === 0 ? canvas.width - w - 54 : 54;
        const y = Math.min(canvas.height - h - 130, 300 + (i - 1) * 245);
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,.45)";
        ctx.shadowBlur = 34;
        ctx.shadowOffsetY = 18;
        ctx.drawImage(image, x, y, w, h);
        ctx.restore();
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) throw new Error("COMPOSITE_FAILED");
      const id = uid();
      let persisted = true;
      try {
        const storedId = await putLocalImage(blob);
        sessionBlobs.current.set(storedId, blob);
        setBg({ kind: "local", localId: storedId });
        await refreshLocalImages();
      } catch {
        persisted = false;
        sessionBlobs.current.set(id, blob);
        unpersisted.current.add(id);
        setBg({ kind: "local", localId: id });
      }
      setStatus({
        text: persisted
          ? `تم تركيب ${bitmaps.length} صور في مشهد واحد. اضغط «تحسين ودمج بالذكاء الاصطناعي» لمواءمة الإضاءة والألوان؛ الساعة والنصوص تبقى طبقات قابلة للتعديل.`
          : "تم تركيب الصور مؤقتًا، لكن التخزين المحلي غير متاح؛ نزّل النتيجة قبل إغلاق الصفحة.",
        tone: persisted ? "ok" : "error",
      });
    } catch (error) {
      setStatus(describeImageError(error));
    } finally {
      bitmaps.forEach((bitmap) => bitmap.close());
      setBusy(false);
    }
  }

  /* ----------------------------- مكتبة الموقع ----------------------------- */

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => window.clearTimeout(t);
  }, [query]);

  const fetchLibrary = useCallback(async (reset: boolean, cursor: string | null) => {
    libAbort.current?.abort();
    const abort = new AbortController();
    libAbort.current = abort;
    setLibLoading(true);
    setLibError("");
    try {
      const params = new URLSearchParams();
      if (debouncedQuery) params.set("q", debouncedQuery);
      if (category) params.set("category", category);
      if (favOnly) params.set("favorites", "1");
      if (!reset && cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/wallpapers/studio/library?${params}`, { signal: abort.signal });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { items: LibraryItem[]; nextCursor: string | null };
      setLibrary((prev) => (reset ? data.items : [...prev, ...data.items]));
      setLibCursor(data.nextCursor);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setLibError("تعذر تحميل المكتبة. حاول مرة أخرى.");
    } finally {
      if (libAbort.current === abort) setLibLoading(false);
    }
  }, [debouncedQuery, category, favOnly]);

  useEffect(() => {
    void fetchLibrary(true, null);
    return () => libAbort.current?.abort();
  }, [fetchLibrary]);

  function pickLibraryItem(item: LibraryItem) {
    if (item.locked) {
      setStatus({ text: "هذه الخلفية مخصصة لمشتركي VIP.", tone: "error", link: VIP_LINK });
      return;
    }
    setBg({ kind: "library", wallpaperId: item.id });
  }

  /* ----------------------------- القوالب والتأثيرات ----------------------------- */

  function applyTemplate(id: StudioTemplateId) {
    const template = getTemplate(id);
    if (template.tier === "VIP" && !vipOk) {
      setStatus({ text: `قالب ${template.name} متاح لمشتركي VIP فقط.`, tone: "error", link: VIP_LINK });
      return;
    }
    const d = docRef.current;
    commit({ ...d, templateId: id, layers: template.build(playerName) });
    setSelectedId(null);
    setStatus({ text: `تم تطبيق قالب ${template.name}`, tone: "ok" });
  }

  function chooseEffect(effect: StudioEffectKey) {
    if (STUDIO_EFFECTS[effect].tier === "VIP" && !vipOk) {
      setStatus({ text: `تأثير ${STUDIO_EFFECTS[effect].label} متاح لمشتركي VIP فقط.`, tone: "error", link: VIP_LINK });
      return;
    }
    commit({ ...docRef.current, effect });
  }

  function stripVipFeatures() {
    const d = docRef.current;
    commit({
      ...d,
      templateId: getTemplate(d.templateId).tier === "VIP" ? "minimal" : d.templateId,
      effect: STUDIO_EFFECTS[d.effect].tier === "VIP" ? "none" : d.effect,
      layers: d.layers.map((l) => ({ ...l, glow: false, fontFamily: STUDIO_FONTS[l.fontFamily].tier === "VIP" ? "sans" : l.fontFamily })),
    });
    setStatus({ text: "تمت إزالة عناصر VIP من التصميم.", tone: "ok" });
  }

  function changePlayerName(value: string) {
    setPlayerName(value);
    const d = docRef.current;
    const target = d.layers.find((l) => l.kind === "name");
    if (target) commit({ ...d, layers: d.layers.map((l) => (l.id === target.id ? { ...l, text: value } : l)) }, "player-name");
  }

  function toggleAuto(layer: StudioLayer) {
    // عند إيقاف التحديث التلقائي نثبّت القيمة الحالية كنص قابل للتعديل
    updateLayer(layer.id, layer.auto ? { auto: false, text: resolveLayerText(layer, new Date()) } : { auto: true });
  }

  /* ----------------------------- التصدير والمشاركة ----------------------------- */

  async function renderBlob(): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = STUDIO_W;
    canvas.height = STUDIO_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("NO_CANVAS");
    const d = docRef.current;
    // مشهد جديد بدون إطار التحديد، والساعة تُحسب لحظة التصدير
    drawScene(ctx, { background: bgRef.current, overlay: getTemplate(d.templateId).overlay, effect: d.effect, layers: d.layers, now: new Date() });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, exportType, 0.95));
    if (!blob) throw new Error("EXPORT_FAILED");
    return blob;
  }

  function applyClockComposition() {
    if (bgLoading || !bgRef.current) {
      setStatus({ text: "اختر خلفية وانتظر اكتمال تحميلها أولًا.", tone: "error" });
      return;
    }

    // Arrange existing live layers; preserve the selected background and never call image generation.
    const current = docRef.current;
    let clockAdded = false;
    const layers = current.layers.map((layer) => {
      if (layer.kind === "clock") {
        clockAdded = true;
        return { ...layer, x: 540, y: 690, fontSize: Math.max(layer.fontSize, 145), align: "center" as const, shadow: Math.max(layer.shadow, 18), glow: vipOk ? true : false };
      }
      if (layer.kind === "gregorian") return { ...layer, x: 540, y: 850, align: "center" as const, shadow: Math.max(layer.shadow, 10) };
      if (layer.kind === "hijri") return { ...layer, x: 540, y: 925, align: "center" as const, shadow: Math.max(layer.shadow, 12), glow: vipOk ? true : false };
      if (layer.kind === "name") return { ...layer, x: 540, y: 1580, align: "center" as const, shadow: Math.max(layer.shadow, 14), glow: vipOk ? true : false };
      if (layer.kind === "text") return { ...layer, x: 540, y: Math.min(1450, Math.max(1120, layer.y)), align: "center" as const, shadow: Math.max(layer.shadow, 14), glow: vipOk ? true : false };
      return layer;
    });
    if (!clockAdded) {
      if (layers.length >= STUDIO_MAX_LAYERS) {
        setStatus({ text: "وصلت إلى الحد الأقصى للطبقات (" + STUDIO_MAX_LAYERS + "). احذف طبقة ثم أعد المحاولة.", tone: "error" });
        return;
      }
      layers.push(makeLayer({ kind: "clock", x: 540, y: 690, fontSize: 145, align: "center", color: "#FFFFFF", shadow: 18, glow: vipOk }));
    }
    commit({ ...current, layers });
    setTab("layers");
    setStatus({ text: "تم دمج الساعة بصريًا مع الخلفية الحالية. الخلفية الأصلية محفوظة، ويمكنك تحريك الساعة وتعديلها ثم تنزيل التصميم.", tone: "ok" });
  }

  function checkExportAllowed(): boolean {
    if (lockedByVip) {
      setStatus({ text: "التصميم يحتوي على عناصر VIP وحسابك غير مشترك حاليًا. أزلها أو جدّد اشتراكك.", tone: "error", link: VIP_LINK });
      return false;
    }
    if (bgLoading) {
      setStatus({ text: "انتظر حتى تكتمل الخلفية.", tone: "error" });
      return false;
    }
    return true;
  }

  function download(blob: Blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gamevortex-${docRef.current.target}-${Date.now()}.${exportType === "image/png" ? "png" : "jpg"}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 15_000);
  }

  async function onDownload() {
    if (!checkExportAllowed()) return;
    setBusy(true);
    try {
      download(await renderBlob());
      setStatus({ text: "تم تنزيل الصورة. افتحها من المعرض واخترها كخلفية من إعدادات الهاتف.", tone: "ok" });
    } catch {
      setStatus({ text: "تعذر تجهيز الصورة. جرّب خلفية أخرى أو صيغة JPEG.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function onShare() {
    if (!checkExportAllowed()) return;
    setBusy(true);
    try {
      const blob = await renderBlob();
      const ext = exportType === "image/png" ? "png" : "jpg";
      const file = new File([blob], `gamevortex-${docRef.current.target}.${ext}`, { type: exportType });
      if (typeof navigator.share === "function" && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ title: "GameVortex Wallpaper", files: [file] });
          setStatus({ text: "تم فتح مشاركة الهاتف. اختر «تعيين كخلفية» إن كان متاحًا في جهازك.", tone: "ok" });
          return;
        } catch (error) {
          if ((error as Error).name === "AbortError") {
            setStatus({ text: "تم إلغاء المشاركة.", tone: "ok" });
            return;
          }
          // فشلت المشاركة لسبب آخر: ننزّل مباشرة
        }
      }
      download(blob);
      setStatus({ text: "المشاركة غير متاحة في هذا المتصفح، فتم تنزيل الصورة بدلًا منها.", tone: "ok" });
    } catch {
      setStatus({ text: "تعذر تجهيز الصورة للمشاركة.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  /* ----------------------------- حفظ التصاميم ----------------------------- */

  const refreshServerDesigns = useCallback(async () => {
    if (!access.loggedIn) return;
    try {
      const res = await fetch("/api/wallpapers/studio/designs", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { designs: ServerDesignRow[] };
      setServerDesigns(data.designs);
    } catch {
      setStatus({ text: "تعذر تحميل تصاميمك المحفوظة.", tone: "error" });
    }
  }, [access.loggedIn]);

  useEffect(() => {
    setLocalDesigns(readLocalDesigns());
    void refreshServerDesigns();
  }, [refreshServerDesigns]);

  function ensureBackgroundSavable(): boolean {
    if (bg.kind === "local" && unpersisted.current.has(bg.localId)) {
      setStatus({ text: "هذه الصورة غير محفوظة على جهازك (التخزين المحلي غير متاح)، لذلك لا يمكن حفظ التصميم بها. نزّل التصميم بدلًا من ذلك.", tone: "error" });
      return false;
    }
    return true;
  }

  async function saveDesign(asNew: boolean) {
    if (!ensureBackgroundSavable()) return;
    const name = designName.trim() || "تصميمي";
    setBusy(true);
    try {
      if (!access.loggedIn) {
        const list = readLocalDesigns();
        const existing = !asNew && currentDesign?.kind === "local" ? list.find((d) => d.id === currentDesign.id) : undefined;
        const entry: LocalDesign = { id: existing?.id ?? uid(), name, background: bg, document: toDocument(docRef.current), updatedAt: new Date().toISOString() };
        const next = existing ? list.map((d) => (d.id === entry.id ? entry : d)) : [entry, ...list];
        if (!existing && next.length > 20) {
          setStatus({ text: "وصلت إلى حد 20 تصميمًا على هذا الجهاز. احذف تصميمًا أو سجّل الدخول لحفظ تصاميمك في حسابك.", tone: "error" });
          return;
        }
        if (!writeLocalDesigns(next)) {
          setStatus({ text: "تعذر الحفظ؛ مساحة تخزين المتصفح قد تكون ممتلئة.", tone: "error" });
          return;
        }
        setLocalDesigns(next);
        setCurrentDesign({ kind: "local", id: entry.id });
        setStatus({ text: "تم حفظ التصميم على هذا الجهاز. سجّل الدخول لحفظه في حسابك.", tone: "ok" });
        return;
      }
      const update = !asNew && currentDesign?.kind === "server";
      const res = await fetch(update ? `/api/wallpapers/studio/designs/${currentDesign!.id}` : "/api/wallpapers/studio/designs", {
        method: update ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, background: bg, document: toDocument(docRef.current) }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; design?: { id: string } };
      if (!res.ok || !data.design) {
        setStatus(describeApiError(data.error, access));
        return;
      }
      setCurrentDesign({ kind: "server", id: data.design.id });
      setStatus({ text: update ? "تم تحديث التصميم." : "تم حفظ التصميم في حسابك.", tone: "ok" });
      await refreshServerDesigns();
    } catch {
      setStatus({ text: "تعذر الاتصال بالخادم. لم يُحفظ التصميم.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  function applyOpenedDesign(source: { name: string; background: StudioBackground; document: unknown }, current: CurrentDesign) {
    const parsed = studioDocumentSchema.safeParse(source.document);
    if (!parsed.success) {
      setStatus({ text: "بيانات التصميم تالفة ولا يمكن فتحه.", tone: "error" });
      return;
    }
    const d = parsed.data;
    setDoc({ templateId: d.templateId, effect: d.effect, target: d.target, layers: d.layers });
    resetHistory();
    setBg(source.background);
    setDesignName(source.name);
    setCurrentDesign(current);
    setSelectedId(null);
    const nameLayer = d.layers.find((l) => l.kind === "name");
    if (nameLayer) setPlayerName(nameLayer.text);
    const vipUsed = listVipFeatures(d).length > 0;
    setStatus(
      vipUsed && !vipOk
        ? { text: `تم فتح «${source.name}». يحتوي على عناصر VIP وحسابك غير مشترك حاليًا؛ التصدير معطّل حتى تزيلها أو تجدد اشتراكك.`, tone: "error", link: VIP_LINK }
        : { text: `تم فتح «${source.name}».`, tone: "ok" },
    );
    setTab("text");
  }

  async function openServerDesign(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/wallpapers/studio/designs/${id}`, { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { error?: string; design?: { name: string; background: StudioBackground; document: unknown } };
      if (!res.ok || !data.design) {
        setStatus(describeApiError(data.error, access));
        return;
      }
      applyOpenedDesign(data.design, { kind: "server", id });
    } catch {
      setStatus({ text: "تعذر فتح التصميم.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function deleteServerDesign(id: string) {
    if (!window.confirm("حذف هذا التصميم نهائيًا؟")) return;
    try {
      const res = await fetch(`/api/wallpapers/studio/designs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      if (currentDesign?.id === id) setCurrentDesign(null);
      await refreshServerDesigns();
    } catch {
      setStatus({ text: "تعذر حذف التصميم.", tone: "error" });
    }
  }

  function deleteLocalDesign(id: string) {
    const next = readLocalDesigns().filter((d) => d.id !== id);
    writeLocalDesigns(next);
    setLocalDesigns(next);
    if (currentDesign?.id === id) setCurrentDesign(null);
  }

  async function moveLocalToAccount(design: LocalDesign) {
    if (design.background.kind === "local") {
      setStatus({ text: "هذا التصميم يستخدم صورة خاصة محفوظة على جهازك فقط، ولا يمكن نقله للحساب. غيّر الخلفية أولًا.", tone: "error" });
      return;
    }
    try {
      const res = await fetch("/api/wallpapers/studio/designs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: design.name, background: design.background, document: design.document }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus(describeApiError(data.error, access));
        return;
      }
      deleteLocalDesign(design.id);
      await refreshServerDesigns();
      setStatus({ text: "تم نقل التصميم إلى حسابك.", tone: "ok" });
    } catch {
      setStatus({ text: "تعذر نقل التصميم.", tone: "error" });
    }
  }

  /* ----------------------------- الواجهة ----------------------------- */

  const activeTemplate = getTemplate(doc.templateId);
  const targetLabel = doc.target === "both" ? "الرئيسية + القفل" : doc.target === "home" ? "الشاشة الرئيسية" : "شاشة القفل";
  const layersTopFirst = [...doc.layers].reverse();

  return (
    <main className="wrap wsx" dir="rtl" style={{ maxWidth: 1200, paddingBottom: 36 }}>
    <style jsx global>{`
      .wsx { --studio-accent: #a855f7; --studio-border: rgba(168,85,247,.22); }
      .wsx .wsx-grid { display:grid; grid-template-columns:minmax(0,.92fr) minmax(0,1.08fr); gap:14px; align-items:start; }
      .wsx .glass.card { border:1px solid var(--studio-border); border-radius:24px; background:linear-gradient(155deg,rgba(17,18,38,.94),rgba(7,9,20,.96)); box-shadow:0 12px 36px rgba(0,0,0,.22); }
      .wsx .wsx-tabs { display:flex; gap:6px; overflow-x:auto; overscroll-behavior-inline:contain; scrollbar-width:none; padding:2px 0 9px; border-bottom:1px solid rgba(168,85,247,.18); }
      .wsx .wsx-tabs::-webkit-scrollbar { display:none; }
      .wsx .wsx-tabs .platform-chip { flex:0 0 auto; min-height:36px; padding:7px 12px; border-radius:13px; font-size:12px; font-weight:700; line-height:1.2; white-space:nowrap; }
      .wsx .platform-chip { min-height:34px; padding:7px 12px; border-radius:14px; font-size:12px; line-height:1.2; }
      .wsx .btn { min-height:40px; padding:9px 13px; border-radius:14px; font-size:13px; font-weight:700; }
      .wsx .btn.secondary { border-color:rgba(168,85,247,.28); }
      .wsx .input { min-height:40px; border-radius:13px; font-size:13px; }
      .wsx .badge { border-radius:999px; padding:7px 10px; font-size:11px; line-height:1.35; }
      .wsx .wsx-row { gap:7px; }
      .wsx .wsx-thumbs { gap:8px; }
      .wsx .wsx-thumb { border-radius:12px; overflow:hidden; }
      .wsx .wsx-grid > .glass.card:first-child { position:sticky; top:12px; }
      .wsx .wsx-grid > aside { min-width:0; }
      @media (max-width: 760px) {
        .wsx { padding-inline:10px !important; padding-top:8px !important; }
        .wsx .hero { padding:12px !important; border-radius:20px; }
        .wsx .hero h1 { font-size:20px; line-height:1.3; }
        .wsx .hero .wsx-row { align-items:flex-start; flex-wrap:wrap; }
        .wsx .hero .wsx-row > .wsx-row { width:100%; gap:6px; }
        .wsx .hero .btn { min-height:34px; padding:7px 10px; font-size:11px; }
        .wsx .wsx-grid { grid-template-columns:minmax(0,1fr); gap:10px; margin-top:10px !important; }
        .wsx .wsx-grid > .glass.card:first-child { position:relative; top:auto; padding:10px !important; gap:8px !important; }
        .wsx .wsx-grid > .glass.card:first-child > div:first-child { width:min(100%,330px) !important; padding:5px !important; border-radius:25px !important; }
        .wsx .wsx-grid > .glass.card:first-child canvas { border-radius:20px !important; }
        .wsx .wsx-grid > aside { padding:10px !important; border-radius:20px; }
        .wsx .wsx-tabs { gap:5px; margin-inline:-1px; }
        .wsx .wsx-tabs .platform-chip { min-height:34px; padding:7px 10px; font-size:11px; }
        .wsx .wsx-grid .wsx-row { gap:6px; flex-wrap:wrap; }
        .wsx .wsx-grid .platform-chip { min-height:32px; padding:6px 10px; font-size:11px; }
        .wsx .wsx-grid .btn { min-height:38px; padding:8px 10px; font-size:12px; }
        .wsx .wsx-grid .input { min-height:38px; font-size:12px; }
        .wsx .wsx-grid .badge { font-size:10px; padding:6px 9px; }
        .wsx .wsx-grid aside p { line-height:1.7; }
      }
    `}</style>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onUpload} hidden />
      <input ref={multiFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onUploadMultiple} multiple hidden />

      <section className="glass hero" style={{ padding: 16 }}>
        <div className="wsx-row" style={{ justifyContent: "space-between" }}>
          <div>
            <p className="muted" style={{ margin: 0 }}>GAMEVORTEX WALLPAPER STUDIO</p>
            <h1 style={{ margin: "6px 0" }}>اصنع خلفيتك الخاصة</h1>
            <p className="muted" style={{ margin: 0 }}>
              {vipOk ? (access.isOwner ? "حساب المالك — كل الأدوات مفتوحة." : "اشتراك VIP نشط — كل الأدوات مفتوحة.") : "الأدوات الأساسية مجانية. عناصر 💎 لمشتركي VIP."}
            </p>
          </div>
          <div className="wsx-row">
            <Link href="/wallpapers/merge" className="btn secondary">✨ Smart Merge</Link>
            <button className="btn secondary" onClick={undo} disabled={!past.current.length} aria-label="تراجع">↶ تراجع</button>
            <button className="btn secondary" onClick={redo} disabled={!future.current.length} aria-label="إعادة">↷ إعادة</button>
          </div>
        </div>
      </section>

      <section className="wsx-grid" style={{ marginTop: 16 }}>
        <div className="glass card" style={{ padding: 14, display: "grid", placeItems: "center", alignContent: "start", gap: 10 }}>
          <div style={{ width: "min(100%, 390px)", background: "#07090d", padding: 7, borderRadius: 34, boxShadow: "0 25px 70px rgba(0,0,0,.55)", position: "relative" }}>
            <canvas ref={canvasRef} width={STUDIO_W} height={STUDIO_H} aria-label="معاينة خلفية الهاتف" style={{ display: "block", width: "100%", height: "auto", borderRadius: 28 }} />
            <canvas
              ref={overlayRef}
              width={STUDIO_W}
              height={STUDIO_H}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              aria-label="منطقة تحريك العناصر"
              style={{ position: "absolute", inset: 7, width: "calc(100% - 14px)", height: "calc(100% - 14px)", borderRadius: 28, touchAction: "none" }}
            />
            {bgLoading && <div className="badge" style={{ position: "absolute", top: 18, insetInlineStart: 18 }}>جاري التحميل…</div>}
          </div>
          <div className="wsx-row" style={{ justifyContent: "center" }}>
            {(["home", "lock", "both"] as const).map((v) => (
              <button key={v} className={`platform-chip ${doc.target === v ? "active" : ""}`} onClick={() => commit({ ...docRef.current, target: v })}>
                {v === "home" ? "الرئيسية" : v === "lock" ? "القفل" : "كلاهما"}
              </button>
            ))}
          </div>
          <div className="wsx-row" style={{ justifyContent: "center" }}>
            <span className="badge">{targetLabel}</span>
            <span className="badge">1080×1920</span>
            <span className="badge" style={{ borderColor: activeTemplate.accent }}>{activeTemplate.name}</span>
          </div>
          <div className="wsx-row" style={{ justifyContent: "center", width: "100%" }}>
            <select className="input" value={exportType} onChange={(e) => setExportType(e.target.value as typeof exportType)} aria-label="صيغة التصدير" style={{ width: "auto" }}>
              <option value="image/png">PNG</option>
              <option value="image/jpeg">JPEG</option>
            </select>
            <button className="btn" onClick={onDownload} disabled={busy}>⬇ تنزيل</button>
            <button className="btn secondary" onClick={onShare} disabled={busy}>📤 مشاركة / تعيين</button>
          </div>
          <p className="muted" style={{ fontSize: 12, margin: 0, textAlign: "center" }}>
            الموقع لا يعيّن الخلفية تلقائيًا: نزّل الصورة أو شاركها ثم اخترها كخلفية من هاتفك.
          </p>
        </div>

        <aside className="glass card" style={{ padding: 14, minWidth: 0 }}>
          <div className="wsx-tabs">
            {TAB_LABELS.map(([key, label]) => (
              <button key={key} className={`platform-chip ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>{label}</button>
            ))}
          </div>

          {status && (
            <div className="badge" role="status" style={{ display: "block", whiteSpace: "normal", margin: "10px 0", borderColor: status.tone === "error" ? "rgba(251,113,133,.6)" : undefined }}>
              {status.text}{" "}
              {status.link && <Link href={status.link.href} style={{ textDecoration: "underline" }}>{status.link.label}</Link>}
            </div>
          )}
          {lockedByVip && (
            <div className="badge" style={{ display: "block", whiteSpace: "normal", margin: "10px 0" }}>
              التصميم يحتوي عناصر VIP. <button className="btn secondary" onClick={stripVipFeatures}>إزالة عناصر VIP</button>
            </div>
          )}

          {tab === "background" && (
            <div style={{ display: "grid", gap: 10 }}>
              <button className="btn" onClick={applyClockComposition} disabled={busy || bgLoading || bg.kind === "none"}>
                ◷ دمج الساعة مع الخلفية
              </button>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                ينسّق الساعة والتاريخ والنصوص فوق الخلفية التي اخترتها دون إنشاء صورة جديدة أو إرسالها إلى خدمة ذكاء اصطناعي. تبقى كل العناصر قابلة للتحريك والتعديل.
              </p>
              <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>＋ صورة من الهاتف (خاصة بك)</button>
              <button className="btn secondary" onClick={() => multiFileRef.current?.click()} disabled={busy}>▧ دمج صورتين أو أكثر</button>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>اختر حتى 8 صور لتركيب خلفية واحدة محليًا على جهازك، ثم أضف الساعة والنصوص ونسّقها.</p>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>الصور التي ترفعها تبقى على جهازك ولا تُنشر في مكتبة الموقع.</p>
              {localImages.length > 0 && (
                <div>
                  <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>صوري على هذا الجهاز</div>
                  <div className="wsx-thumbs">
                    {localImages.map((img) => (
                      <div key={img.id} style={{ position: "relative" }}>
                        <button className="wsx-thumb" onClick={() => setBg({ kind: "local", localId: img.id })} aria-label="استخدام الصورة">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url} alt="" />
                        </button>
                        <button className="wsx-x" onClick={() => void removeLocalImage(img.id)} aria-label="حذف الصورة">✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {bg.kind !== "none" && <button className="btn secondary" onClick={() => setBg({ kind: "none" })}>إزالة الخلفية</button>}

              <div className="muted" style={{ fontSize: 13 }}>مكتبة GameVortex</div>
              <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="ابحث…" aria-label="بحث في المكتبة" />
              <div className="wsx-tabs">
                <button className={`platform-chip ${category === "" ? "active" : ""}`} onClick={() => setCategory("")}>الكل</button>
                {categories.map((c) => (
                  <button key={c} className={`platform-chip ${category === c ? "active" : ""}`} onClick={() => setCategory(c)}>{CATEGORY_LABELS[c] ?? c}</button>
                ))}
                {access.loggedIn && <button className={`platform-chip ${favOnly ? "active" : ""}`} onClick={() => setFavOnly((v) => !v)}>❤️ المفضلة</button>}
              </div>
              {libError && <div className="badge" style={{ display: "block", whiteSpace: "normal" }}>{libError}</div>}
              <div className="wsx-thumbs">
                {library.map((item) => {
                  const selected = bg.kind === "library" && bg.wallpaperId === item.id;
                  return (
                    <button key={item.id} className="wsx-thumb" onClick={() => pickLibraryItem(item)} aria-label={item.title} style={selected ? { outline: "2px solid #67e8f9" } : undefined}>
                      {item.locked || !item.thumb ? (
                        <span style={{ display: "grid", placeItems: "center", aspectRatio: "9/14", color: "rgba(255,255,255,.8)" }}>💎 VIP</span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.thumb} alt="" loading="lazy" decoding="async" />
                      )}
                      {item.isVip && !item.locked && <span className="badge" style={{ display: "block", borderRadius: 0 }}>VIP</span>}
                    </button>
                  );
                })}
              </div>
              {!libLoading && library.length === 0 && !libError && <p className="muted">لا توجد خلفيات مطابقة.</p>}
              {libCursor && <button className="btn secondary" onClick={() => void fetchLibrary(false, libCursor)} disabled={libLoading}>{libLoading ? "جاري التحميل…" : "عرض المزيد"}</button>}
            </div>
          )}

          {tab === "templates" && (
            <div style={{ display: "grid", gap: 9 }}>
              <label>اسم اللاعب
                <input className="input" value={playerName} maxLength={24} onChange={(e) => changePlayerName(e.target.value)} />
              </label>
              {STUDIO_TEMPLATES.map((t) => (
                <button key={t.id} onClick={() => applyTemplate(t.id)} className="wsx-card-btn" style={{ borderColor: doc.templateId === t.id ? t.accent : undefined }}>
                  <strong>{t.name}{t.tier === "VIP" ? " 💎" : ""}</strong>
                  <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{t.description}</div>
                </button>
              ))}
            </div>
          )}

          {tab === "text" && (
            <div style={{ display: "grid", gap: 10 }}>
              <div className="wsx-row">
                <button className="btn secondary" onClick={() => addLayer(makeLayer({ kind: "clock", y: 960, fontSize: 150 }))}>＋ ساعة</button>
                <button className="btn secondary" onClick={() => addLayer(makeLayer({ kind: "gregorian", y: 960, fontSize: 42 }))}>＋ ميلادي</button>
                <button className="btn secondary" onClick={() => addLayer(makeLayer({ kind: "hijri", y: 960, fontSize: 38 }))}>＋ هجري</button>
              </div>
              <textarea className="input" rows={3} value={customText} onChange={(e) => setCustomText(e.target.value.slice(0, 300))} placeholder="اكتب نصًا عربيًا أو إنجليزيًا…" />
              <button className="btn" disabled={!customText.trim()} onClick={() => { addLayer(makeLayer({ kind: "text", text: customText.trim(), y: 1100 })); setCustomText(""); }}>＋ إضافة النص</button>
              <label>أذكار
                <select className="input" value="" onChange={(e) => { if (e.target.value) addLayer(makeLayer({ kind: "text", text: e.target.value, y: 1250, fontSize: 40, fontFamily: "tahoma" })); }}>
                  <option value="">اختر ذكرًا…</option>
                  {STUDIO_ADHKAR.map((z) => <option key={z} value={z}>{z.length > 40 ? `${z.slice(0, 40)}…` : z}</option>)}
                </select>
              </label>
              <div className="wsx-row">
                {STUDIO_PHRASES.map((p) => <button key={p} className="platform-chip" onClick={() => addLayer(makeLayer({ kind: "text", text: p, y: 1300, fontSize: 70, weight: 800 }))}>{p}</button>)}
              </div>

              {selectedLayer ? (
                <LayerEditor
                  layer={selectedLayer}
                  now={now}
                  vipOk={vipOk}
                  onChange={(patch, key) => updateLayer(selectedLayer.id, patch, key)}
                  onToggleAuto={() => toggleAuto(selectedLayer)}
                  onMove={(to) => moveLayer(selectedLayer.id, to)}
                  onDuplicate={() => addLayer({ ...selectedLayer, id: uid(), x: selectedLayer.x + 30, y: selectedLayer.y + 30 })}
                  onDelete={() => removeLayer(selectedLayer.id)}
                  onVipBlocked={(what) => setStatus({ text: `${what} متاح لمشتركي VIP فقط.`, tone: "error", link: VIP_LINK })}
                />
              ) : (
                <p className="muted">اضغط على عنصر داخل المعاينة لتحديده وتحريكه. استخدم إصبعين للتكبير والتدوير.</p>
              )}
            </div>
          )}

          {tab === "layers" && (
            <div style={{ display: "grid", gap: 8 }}>
              {layersTopFirst.length === 0 && <p className="muted">لا توجد طبقات بعد.</p>}
              {layersTopFirst.map((layer) => (
                <div key={layer.id} className="wsx-layer" style={layer.id === selectedId ? { borderColor: "#67e8f9" } : undefined}>
                  <button className="wsx-layer-name" onClick={() => { setSelectedId(layer.id); setTab("text"); }}>
                    {layer.kind === "clock" ? "🕒 " : layer.kind === "hijri" ? "🌙 " : layer.kind === "gregorian" ? "📅 " : "🔤 "}
                    {resolveLayerText(layer, now).replace(/\n/g, " ").slice(0, 28) || "(فارغ)"}
                  </button>
                  <button className="btn secondary" onClick={() => updateLayer(layer.id, { visible: !layer.visible })} aria-label={layer.visible ? "إخفاء" : "إظهار"}>{layer.visible ? "👁" : "🚫"}</button>
                  <button className="btn secondary" onClick={() => moveLayer(layer.id, "up")} aria-label="للأمام">▲</button>
                  <button className="btn secondary" onClick={() => moveLayer(layer.id, "down")} aria-label="للخلف">▼</button>
                </div>
              ))}
            </div>
          )}

          {tab === "effects" && (
            <div style={{ display: "grid", gap: 8 }}>
              {STUDIO_EFFECT_KEYS.map((key) => (
                <button key={key} className={`btn ${doc.effect === key ? "" : "secondary"}`} onClick={() => chooseEffect(key)}>
                  {STUDIO_EFFECTS[key].label}{STUDIO_EFFECTS[key].tier === "VIP" ? " 💎" : ""}
                </button>
              ))}
              <p className="muted" style={{ fontSize: 13 }}>كل التأثيرات تعمل داخل المتصفح ولا تحتاج خدمة خارجية.</p>
            </div>
          )}

          {tab === "designs" && (
            <div style={{ display: "grid", gap: 10 }}>
              <label>اسم التصميم
                <input className="input" value={designName} maxLength={60} onChange={(e) => setDesignName(e.target.value)} />
              </label>
              <div className="wsx-row">
                <button className="btn" onClick={() => void saveDesign(false)} disabled={busy}>{currentDesign ? "تحديث التصميم" : "حفظ التصميم"}</button>
                {currentDesign && <button className="btn secondary" onClick={() => void saveDesign(true)} disabled={busy}>حفظ كنسخة جديدة</button>}
              </div>
              {!access.loggedIn && (
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                  أنت غير مسجل: التصاميم تُحفظ على هذا الجهاز فقط. <Link href="/auth/login?next=/wallpapers/studio" style={{ textDecoration: "underline" }}>سجّل الدخول</Link> لحفظها في حسابك.
                </p>
              )}

              {access.loggedIn && (
                <>
                  <div className="badge">تصاميم حسابك ({serverDesigns.length}{saveLimitFor({ isVip: access.isVip, isOwner: access.isOwner }) ? ` / ${saveLimitFor({ isVip: access.isVip, isOwner: access.isOwner })}` : ""})</div>
                  {serverDesigns.length === 0 && <p className="muted">لا توجد تصاميم محفوظة بعد.</p>}
                  {serverDesigns.map((d) => (
                    <div key={d.id} className="wsx-layer">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}{d.tier === "VIP" ? " 💎" : ""}</strong>
                        <span className="muted" style={{ fontSize: 12 }}>{new Date(d.updatedAt).toLocaleString("ar")}</span>
                      </div>
                      <button className="btn secondary" onClick={() => void openServerDesign(d.id)} disabled={busy}>فتح</button>
                      <button className="btn secondary" onClick={() => void deleteServerDesign(d.id)}>حذف</button>
                    </div>
                  ))}
                </>
              )}

              {localDesigns.length > 0 && (
                <>
                  <div className="badge">على هذا الجهاز ({localDesigns.length})</div>
                  {localDesigns.map((d) => (
                    <div key={d.id} className="wsx-layer">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</strong>
                        <span className="muted" style={{ fontSize: 12 }}>{new Date(d.updatedAt).toLocaleString("ar")}</span>
                      </div>
                      <button className="btn secondary" onClick={() => applyOpenedDesign(d, { kind: "local", id: d.id })}>فتح</button>
                      {access.loggedIn && <button className="btn secondary" onClick={() => void moveLocalToAccount(d)}>نقل للحساب</button>}
                      <button className="btn secondary" onClick={() => deleteLocalDesign(d.id)}>حذف</button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </aside>
      </section>

      <style>{`
        .wsx-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
        .wsx-grid{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:16px;align-items:start}
        .wsx-tabs{display:flex;gap:6px;flex-wrap:wrap}
        .wsx-thumbs{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
        .wsx-thumb{padding:0;border:1px solid rgba(255,255,255,.12);border-radius:10px;overflow:hidden;background:#111;cursor:pointer;width:100%}
        .wsx-thumb img{display:block;width:100%;aspect-ratio:9/14;object-fit:cover}
        .wsx-x{position:absolute;top:4px;inset-inline-start:4px;width:24px;height:24px;border-radius:50%;border:0;background:rgba(0,0,0,.7);color:#fff;cursor:pointer}
        .wsx-card-btn{text-align:right;padding:12px;border-radius:14px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:inherit;cursor:pointer}
        .wsx-layer{display:flex;gap:6px;align-items:center;padding:8px;border:1px solid rgba(255,255,255,.1);border-radius:12px}
        .wsx-layer-name{flex:1;min-width:0;text-align:right;background:none;border:0;color:inherit;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .wsx label{display:grid;gap:6px;font-size:14px}
        .wsx input[type=range]{width:100%}
        .wsx .input{width:100%}
        @media(max-width:900px){.wsx-grid{grid-template-columns:1fr}.wsx-tabs{position:sticky;top:6px;z-index:5;flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-inline:contain;padding:8px 6px;background:rgba(10,15,30,.96);backdrop-filter:blur(14px);border-radius:14px;scrollbar-width:thin}.wsx-tabs>.platform-chip{flex:0 0 auto;white-space:nowrap}.wsx-grid>aside{min-width:0}.wsx-grid>div{min-width:0}.wsx-grid canvas{max-height:62dvh;object-fit:contain}.wsx-row .btn{min-height:42px}}
      `}</style>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* محرر الطبقة المحددة                                                          */
/* -------------------------------------------------------------------------- */

function LayerEditor({
  layer, now, vipOk, onChange, onToggleAuto, onMove, onDuplicate, onDelete, onVipBlocked,
}: {
  layer: StudioLayer;
  now: Date;
  vipOk: boolean;
  onChange: (patch: Partial<StudioLayer>, coalesceKey?: string) => void;
  onToggleAuto: () => void;
  onMove: (to: "front" | "back" | "up" | "down") => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onVipBlocked: (what: string) => void;
}) {
  const auto = isAutoKind(layer.kind);
  const editableText = !auto || !layer.auto;
  return (
    <div style={{ display: "grid", gap: 9, borderTop: "1px solid rgba(255,255,255,.1)", paddingTop: 10 }}>
      <strong>العنصر المحدد</strong>
      {auto && (
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={layer.auto} onChange={onToggleAuto} />
          تحديث تلقائي ({resolveLayerText({ ...layer, auto: true }, now)})
        </label>
      )}
      {editableText && (
        <label>النص
          <textarea className="input" rows={2} value={layer.text} maxLength={300} onChange={(e) => onChange({ text: e.target.value }, "text")} />
        </label>
      )}
      {layer.kind === "clock" && layer.auto && (
        <div className="wsx-row">
          <select className="input" style={{ width: "auto" }} value={layer.clockFormat} onChange={(e) => onChange({ clockFormat: e.target.value as "24" | "12" })} aria-label="تنسيق الساعة">
            <option value="24">24 ساعة</option>
            <option value="12">12 ساعة</option>
          </select>
        </div>
      )}
      {auto && layer.auto && (
        <div className="wsx-row">
          <select className="input" style={{ width: "auto" }} value={layer.digits} onChange={(e) => onChange({ digits: e.target.value as "latn" | "arab" })} aria-label="نوع الأرقام">
            <option value="latn">أرقام 123</option>
            <option value="arab">أرقام ١٢٣</option>
          </select>
          {layer.kind === "gregorian" && (
            <select className="input" style={{ width: "auto" }} value={layer.dateStyle} onChange={(e) => onChange({ dateStyle: e.target.value as "short" | "long" })} aria-label="شكل التاريخ">
              <option value="short">مختصر</option>
              <option value="long">كامل</option>
            </select>
          )}
        </div>
      )}
      <label>الخط
        <select
          className="input"
          value={layer.fontFamily}
          onChange={(e) => {
            const key = e.target.value as StudioLayer["fontFamily"];
            if (STUDIO_FONTS[key].tier === "VIP" && !vipOk) return onVipBlocked(`خط ${STUDIO_FONTS[key].label}`);
            onChange({ fontFamily: key });
          }}
        >
          {STUDIO_FONT_KEYS.map((key) => <option key={key} value={key}>{STUDIO_FONTS[key].label}{STUDIO_FONTS[key].tier === "VIP" ? " 💎" : ""}</option>)}
        </select>
      </label>
      <label>الحجم ({Math.round(layer.fontSize)})
        <input type="range" min="10" max="400" value={layer.fontSize} onChange={(e) => onChange({ fontSize: Number(e.target.value) }, "fontSize")} />
      </label>
      <label>التكبير ({layer.scale.toFixed(2)})
        <input type="range" min="0.1" max="6" step="0.05" value={layer.scale} onChange={(e) => onChange({ scale: Number(e.target.value) }, "scale")} />
      </label>
      <label>التدوير ({Math.round(layer.rotation)}°)
        <input type="range" min="-180" max="180" value={layer.rotation} onChange={(e) => onChange({ rotation: Number(e.target.value) }, "rotation")} />
      </label>
      <label>الشفافية
        <input type="range" min="0" max="1" step="0.05" value={layer.opacity} onChange={(e) => onChange({ opacity: Number(e.target.value) }, "opacity")} />
      </label>
      <label>الظل
        <input type="range" min="0" max="60" value={layer.shadow} onChange={(e) => onChange({ shadow: Number(e.target.value) }, "shadow")} />
      </label>
      <div className="wsx-row">
        <input type="color" value={layer.color} onChange={(e) => onChange({ color: e.target.value }, "color")} aria-label="لون النص" />
        {(["right", "center", "left"] as const).map((a) => (
          <button key={a} className={`platform-chip ${layer.align === a ? "active" : ""}`} onClick={() => onChange({ align: a })}>{a === "right" ? "يمين" : a === "center" ? "وسط" : "يسار"}</button>
        ))}
        <button className={`platform-chip ${layer.weight >= 700 ? "active" : ""}`} onClick={() => onChange({ weight: layer.weight >= 700 ? 400 : 800 })}>عريض</button>
        <button className={`platform-chip ${layer.glow ? "active" : ""}`} onClick={() => (vipOk ? onChange({ glow: !layer.glow }) : onVipBlocked("التوهج"))}>توهج 💎</button>
      </div>
      <div className="wsx-row">
        <button className="btn secondary" onClick={() => onMove("front")}>إلى الأمام</button>
        <button className="btn secondary" onClick={() => onMove("back")}>إلى الخلف</button>
        <button className="btn secondary" onClick={() => onChange({ visible: !layer.visible })}>{layer.visible ? "إخفاء" : "إظهار"}</button>
        <button className="btn secondary" onClick={onDuplicate}>تكرار</button>
        <button className="btn secondary" onClick={onDelete}>حذف</button>
      </div>
    </div>
  );
}
