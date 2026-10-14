"use client";

import "./viewer.css";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { VIEWER_FONTS, type ViewerFontKey } from "./viewer-fonts";

/* -------------------------------------------------------------------------- */
/* الأنواع والتعريفات                                                          */
/* -------------------------------------------------------------------------- */

type Kind = "clock" | "day" | "date" | "quote";
type Fmt = { h12: boolean; arab: boolean };
type Widget = { id: string; kind: Kind; style: string; x: number; y: number; scale: number; rot: number; color: string; text?: string };
type StyleDef = {
  key: string; kind: Kind; font: ViewerFontKey; size: number; weight: number; lh: number; ls?: number; outline?: boolean;
  lines: (d: Date, f: Fmt, text?: string) => string[];
};
type SheetTab = "clock" | "day" | "date" | "quote";
type DepthState = { status: "idle" | "pick" | "working" | "ready"; url: string | null };

const toArab = (s: string) => s.replace(/\d/g, (c) => "٠١٢٣٤٥٦٧٨٩"[Number(c)]);
const pad = (n: number) => String(n).padStart(2, "0");

function hm(d: Date, f: Fmt, forceArab = false): [string, string] {
  let h = d.getHours();
  if (f.h12) h = h % 12 || 12;
  const out: [string, string] = [pad(h), pad(d.getMinutes())];
  return f.arab || forceArab ? [toArab(out[0]), toArab(out[1])] : out;
}

function safeFormat(locale: string, options: Intl.DateTimeFormatOptions, d: Date, fallback: string): string {
  try { return new Intl.DateTimeFormat(locale, options).format(d); } catch { return fallback; }
}
const dayAr = (d: Date) => safeFormat("ar-EG", { weekday: "long" }, d, "");
const dayEn = (d: Date) => safeFormat("en-US", { weekday: "short" }, d, "").toUpperCase();
const gregAr = (d: Date, f: Fmt) => { const s = safeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long" }, d, ""); return f.arab ? toArab(s) : s; };
const hijriAr = (d: Date, f: Fmt) => { const s = safeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long" }, d, ""); return f.arab ? toArab(s) : s; };
const monEn = (d: Date) => safeFormat("en-US", { month: "short" }, d, "").toUpperCase();

const CLOCK_STYLES: StyleDef[] = [
  { key: "tall", kind: "clock", font: "bebas", size: 270, weight: 400, lh: 0.9, lines: (d, f) => [hm(d, f).join(":")] },
  { key: "stack", kind: "clock", font: "bebas", size: 250, weight: 400, lh: 0.8, lines: (d, f) => [...hm(d, f)] },
  { key: "outline", kind: "clock", font: "bebas", size: 270, weight: 400, lh: 0.9, outline: true, lines: (d, f) => [hm(d, f).join(":")] },
  { key: "thin", kind: "clock", font: "sys", size: 190, weight: 200, lh: 1, lines: (d, f) => [hm(d, f).join(":")] },
  { key: "kufi", kind: "clock", font: "kufi", size: 190, weight: 600, lh: 1, lines: (d, f) => [hm(d, f, true).join(":")] },
  { key: "ruqaa", kind: "clock", font: "ruqaa", size: 220, weight: 700, lh: 1.1, lines: (d, f) => [hm(d, f, true).join(":")] },
];
const DAY_STYLES: StyleDef[] = [
  { key: "d-ruqaa", kind: "day", font: "ruqaa", size: 140, weight: 700, lh: 1.2, lines: (d) => [dayAr(d)] },
  { key: "d-kufi", kind: "day", font: "kufi", size: 130, weight: 600, lh: 1.2, lines: (d) => [dayAr(d)] },
  { key: "d-katibeh", kind: "day", font: "katibeh", size: 200, weight: 400, lh: 1.1, lines: (d) => [dayAr(d)] },
  { key: "d-amiri", kind: "day", font: "amiri", size: 140, weight: 700, lh: 1.2, lines: (d) => [dayAr(d)] },
  { key: "d-lalezar", kind: "day", font: "lalezar", size: 140, weight: 400, lh: 1.2, lines: (d) => [dayAr(d)] },
  { key: "d-latin", kind: "day", font: "bebas", size: 190, weight: 400, lh: 1, ls: 6, lines: (d) => [dayEn(d)] },
];
const DATE_STYLES: StyleDef[] = [
  { key: "g-ruqaa", kind: "date", font: "ruqaa", size: 130, weight: 700, lh: 1.2, lines: (d, f) => [gregAr(d, f)] },
  { key: "h-ruqaa", kind: "date", font: "ruqaa", size: 120, weight: 700, lh: 1.2, lines: (d, f) => [hijriAr(d, f)] },
  { key: "gh-kufi", kind: "date", font: "kufi", size: 62, weight: 600, lh: 1.3, lines: (d, f) => [`${gregAr(d, f)}  |  ${hijriAr(d, f)}`] },
  { key: "g-katibeh", kind: "date", font: "katibeh", size: 170, weight: 400, lh: 1.1, lines: (d, f) => [gregAr(d, f)] },
  { key: "h-amiri", kind: "date", font: "amiri", size: 110, weight: 700, lh: 1.2, lines: (d, f) => [hijriAr(d, f)] },
  { key: "g-latin", kind: "date", font: "bebas", size: 120, weight: 400, lh: 1, ls: 4, lines: (d) => [`${dayEn(d)} ${d.getDate()} ${monEn(d)}`] },
];
const QUOTE_STYLES: StyleDef[] = [
  { key: "q-ruqaa", kind: "quote", font: "ruqaa", size: 78, weight: 700, lh: 1.55, lines: (_d, _f, t) => [t || ""] },
  { key: "q-amiri", kind: "quote", font: "amiri", size: 70, weight: 700, lh: 1.6, lines: (_d, _f, t) => [t || ""] },
  { key: "q-kufi", kind: "quote", font: "kufi", size: 66, weight: 600, lh: 1.5, lines: (_d, _f, t) => [t || ""] },
  { key: "q-katibeh", kind: "quote", font: "katibeh", size: 100, weight: 400, lh: 1.3, lines: (_d, _f, t) => [t || ""] },
];
const QUOTE_LABELS: Record<string, string> = { "q-ruqaa": "رقعة", "q-amiri": "نسخ", "q-kufi": "كوفي", "q-katibeh": "كتيبة" };
const ALL_STYLES: StyleDef[] = [...CLOCK_STYLES, ...DAY_STYLES, ...DATE_STYLES, ...QUOTE_STYLES];
const styleOf = (key: string): StyleDef => ALL_STYLES.find((s) => s.key === key) ?? CLOCK_STYLES[0];

const QUICK_QUOTES = ["وَمَا تَوْفِيقِي إِلَّا بِاللَّهِ", "ولسوف يعطيك ربك فترضى", "اللهم لا سهل إلا ما جعلته سهلا", "كن جميلا ترَ الوجود جميلا", "لا تحزن إن الله معنا"];
const COLORS = ["#ffffff", "#000000", "#f4c95d", "#67e8f9", "#fb7185", "#a3e635", "#c4b5fd"];
const SHEET_TABS: [SheetTab, string][] = [["clock", "الساعة"], ["day", "اليوم"], ["date", "التاريخ"], ["quote", "اقتباس"]];
const DEFAULT_POS: Record<Kind, { x: number; y: number }> = { clock: { x: 50, y: 36 }, day: { x: 50, y: 22 }, date: { x: 50, y: 58 }, quote: { x: 50, y: 74 } };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

/* -------------------------------------------------------------------------- */
/* تأثير العمق (فصل العنصر الأمامي) — يعيد استخدام نفس مكتبة MediaPipe بالمشروع */
/* -------------------------------------------------------------------------- */

const MEDIAPIPE_VERSION = "1.0.1";
const SEGMENTER_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const INTERACTIVE_SEGMENTER_MODEL = "https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/latest/interactive_segmentation.task";

type ConfidenceMask = { width: number; height: number; getAsFloat32Array(): Float32Array };
type InteractiveSegmenter = {
  setImage: (image: HTMLImageElement) => void;
  segment: (strokes: Array<{ brushMode: number; point: Array<{ x: number; y: number }>; isCompleted: boolean }>) => ConfidenceMask;
};
let segmenterPromise: Promise<InteractiveSegmenter> | null = null;

function getInteractiveSegmenter(): Promise<InteractiveSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const { FilesetResolver, InteractiveSegmenter, BrushMode } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(SEGMENTER_WASM);
      const instance = await InteractiveSegmenter.createFromOptions(vision, { baseOptions: { modelAssetPath: INTERACTIVE_SEGMENTER_MODEL } });
      return {
        setImage: (image: HTMLImageElement) => instance.setImage(image),
        segment: (strokes) => instance.segment(strokes.map((s) => ({ ...s, brushMode: BrushMode.POSITIVE }))) as unknown as ConfidenceMask,
      };
    })().catch((error) => { segmenterPromise = null; throw error; });
  }
  return segmenterPromise;
}

/** يرجع رابط صورة PNG شفافة تحتوي العنصر الذي لمسه المستخدم فقط. */
async function buildCutout(img: HTMLImageElement, nx: number, ny: number): Promise<string> {
  const segmenter = await getInteractiveSegmenter();
  segmenter.setImage(img);
  const mask = segmenter.segment([{ brushMode: 0, point: [{ x: nx, y: ny }], isCompleted: true }]);
  const data = mask.getAsFloat32Array();

  const pixels = new Uint8ClampedArray(mask.width * mask.height * 4);
  let covered = 0;
  for (let i = 0; i < data.length; i += 1) {
    const t = clamp((data[i] - 0.35) / 0.3, 0, 1);
    const alpha = Math.round(t * t * (3 - 2 * t) * 255);
    if (alpha > 128) covered += 1;
    const o = i * 4;
    pixels[o] = 255; pixels[o + 1] = 255; pixels[o + 2] = 255; pixels[o + 3] = alpha;
  }
  const coverage = covered / data.length;
  if (coverage < 0.01 || coverage > 0.92) throw new Error("BAD_MASK");

  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * scale));
  const H = Math.max(1, Math.round(img.naturalHeight * scale));
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const ctx = out.getContext("2d");
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = mask.width; maskCanvas.height = mask.height;
  const maskCtx = maskCanvas.getContext("2d");
  if (!ctx || !maskCtx) throw new Error("CANVAS_UNAVAILABLE");
  ctx.drawImage(img, 0, 0, W, H);
  maskCtx.putImageData(new ImageData(pixels, mask.width, mask.height), 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(maskCanvas, 0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("CUTOUT_EXPORT_FAILED");
  return URL.createObjectURL(blob);
}

/* -------------------------------------------------------------------------- */
/* أيقونات                                                                     */
/* -------------------------------------------------------------------------- */

const ICONS: Record<string, string> = {
  set: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2.5 10 2 2 3.5-4",
  download: "M12 4v11m0 0 4-4m-4 4-4-4M5 20h14",
  quote: "M9 7H6a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3v1a3 3 0 0 1-3 3m12-9h-3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3v1a3 3 0 0 1-3 3",
  tools: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM17 14v6m-3-3h6",
  blur: "M12 3s6 6.2 6 10.5A6 6 0 0 1 6 13.5C6 9.2 12 3 12 3Z",
};
function Icon({ name }: { name: keyof typeof ICONS }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name]} /></svg>;
}

/* -------------------------------------------------------------------------- */
/* عنصر نصي واحد (يُرسم مرتين: المحتوى خلف العنصر الأمامي، والإطار فوقه)       */
/* -------------------------------------------------------------------------- */

function TextBlock({ def, now, fmt, color, text, factor = 1 }: { def: StyleDef; now: Date; fmt: Fmt; color: string; text?: string; factor?: number }) {
  const lines = def.lines(now, fmt, text);
  return (
    <span
      className={`gvv-w-content${def.kind === "quote" ? " is-quote" : ""}${def.outline ? " is-outline" : ""}`}
      style={{ fontFamily: VIEWER_FONTS[def.font], fontSize: `${(def.size / 10) * factor}cqw`, fontWeight: def.weight, lineHeight: def.lh, letterSpacing: def.ls ? `${def.ls / 10}cqw` : undefined, color, ["--gvv-c" as string]: color }}
    >
      {lines.map((line, i) => <span key={i} style={{ display: "block" }}>{line}</span>)}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* المكوّن الرئيسي                                                              */
/* -------------------------------------------------------------------------- */

export type WallpaperViewerProps = {
  wallpaperId: string;
  title: string;
  src: string;
  width?: number | null;
  height?: number | null;
  canDownload: boolean;
};

export default function WallpaperViewer({ wallpaperId, title, src, width, height, canDownload }: WallpaperViewerProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const widgetRefs = useRef(new Map<string, HTMLDivElement>());
  const drag = useRef<null | { mode: "move" | "scale" | "rotate"; id: string; sx: number; sy: number; w: Widget; cx: number; cy: number; d0: number; a0: number }>(null);
  const cutoutUrlRef = useRef<string | null>(null);

  const [ratio, setRatio] = useState(width && height ? width / height : 9 / 16);
  const [now, setNow] = useState<Date | null>(null);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [blur, setBlur] = useState(false);
  const [fmt, setFmt] = useState<Fmt>({ h12: false, arab: false });
  const [sheet, setSheet] = useState<SheetTab | null>(null);
  const [depth, setDepth] = useState<DepthState>({ status: "idle", url: null });
  const [toast, setToast] = useState<string | null>(null);
  const [quoteText, setQuoteText] = useState("");
  const [quoteStyle, setQuoteStyle] = useState("q-ruqaa");
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => () => { if (cutoutUrlRef.current) URL.revokeObjectURL(cutoutUrlRef.current); }, []);

  const patch = useCallback((id: string, change: Partial<Widget>) => {
    setWidgets((list) => list.map((w) => (w.id === id ? { ...w, ...change } : w)));
  }, []);

  /* ----------------------------- السحب والتكبير والتدوير ---------------------------- */
  useEffect(() => {
    function onMove(e: PointerEvent) {
      const d = drag.current;
      const stage = stageRef.current;
      if (!d || !stage) return;
      const rect = stage.getBoundingClientRect();
      if (d.mode === "move") {
        patch(d.id, { x: clamp(d.w.x + ((e.clientX - d.sx) / rect.width) * 100, -5, 105), y: clamp(d.w.y + ((e.clientY - d.sy) / rect.height) * 100, -5, 105) });
      } else if (d.mode === "scale") {
        const dist = Math.hypot(e.clientX - d.cx, e.clientY - d.cy);
        patch(d.id, { scale: clamp((d.w.scale * dist) / d.d0, 0.25, 5) });
      } else {
        const a = Math.atan2(e.clientY - d.cy, e.clientX - d.cx);
        patch(d.id, { rot: d.w.rot + ((a - d.a0) * 180) / Math.PI });
      }
    }
    function onUp() { drag.current = null; }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [patch]);

  function begin(e: ReactPointerEvent, mode: "move" | "scale" | "rotate", w: Widget) {
    e.preventDefault();
    e.stopPropagation();
    setSelected(w.id);
    const el = widgetRefs.current.get(w.id);
    const r = el?.getBoundingClientRect();
    const cx = r ? r.left + r.width / 2 : e.clientX;
    const cy = r ? r.top + r.height / 2 : e.clientY;
    drag.current = { mode, id: w.id, sx: e.clientX, sy: e.clientY, w: { ...w }, cx, cy, d0: Math.hypot(e.clientX - cx, e.clientY - cy) || 1, a0: Math.atan2(e.clientY - cy, e.clientX - cx) };
  }

  /* ----------------------------------- إضافة وتعديل ----------------------------------- */
  function applyStyle(def: StyleDef) {
    const current = widgets.find((w) => w.id === selected);
    if (current && current.kind === def.kind) { patch(current.id, { style: def.key }); return; }
    const pos = DEFAULT_POS[def.kind];
    const w: Widget = { id: newId(), kind: def.kind, style: def.key, x: pos.x, y: pos.y, scale: 1, rot: 0, color: "#ffffff" };
    setWidgets((list) => [...list, w]);
    setSelected(w.id);
    setSheet(null);
  }

  function submitQuote() {
    const text = quoteText.trim().slice(0, 160);
    if (!text) { setToast("اكتب الاقتباس أولًا."); return; }
    const current = widgets.find((w) => w.id === selected);
    if (current && current.kind === "quote") { patch(current.id, { text, style: quoteStyle }); setSheet(null); return; }
    const pos = DEFAULT_POS.quote;
    const w: Widget = { id: newId(), kind: "quote", style: quoteStyle, x: pos.x, y: pos.y, scale: 1, rot: 0, color: "#ffffff", text };
    setWidgets((list) => [...list, w]);
    setSelected(w.id);
    setSheet(null);
  }

  function removeWidget(id: string) {
    setWidgets((list) => list.filter((w) => w.id !== id));
    setSelected((s) => (s === id ? null : s));
  }

  function openSheet(tab: SheetTab) {
    const current = widgets.find((w) => w.id === selected);
    if (tab === "quote" && current?.kind === "quote") { setQuoteText(current.text ?? ""); setQuoteStyle(current.style); }
    setSheet(tab);
  }

  /* ------------------------------------- العمق ------------------------------------- */
  function toggleDepth() {
    if (depth.status === "working") return;
    if (depth.status === "ready") {
      if (cutoutUrlRef.current) { URL.revokeObjectURL(cutoutUrlRef.current); cutoutUrlRef.current = null; }
      setDepth({ status: "idle", url: null });
      return;
    }
    setSelected(null);
    setDepth((d) => ({ ...d, status: d.status === "pick" ? "idle" : "pick" }));
  }

  async function onStageClick(e: ReactMouseEvent) {
    if (depth.status !== "pick") return;
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !stage || !img.complete || !img.naturalWidth) { setToast("انتظر حتى تكتمل الصورة."); return; }
    const rect = stage.getBoundingClientRect();
    const nx = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const ny = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    setDepth({ status: "working", url: null });
    try {
      const url = await buildCutout(img, nx, ny);
      if (cutoutUrlRef.current) URL.revokeObjectURL(cutoutUrlRef.current);
      cutoutUrlRef.current = url;
      setDepth({ status: "ready", url });
      setToast("تم. الآن الساعة والنصوص تظهر خلف العنصر.");
    } catch (error) {
      setDepth({ status: "pick", url: null });
      setToast(error instanceof Error && error.message === "BAD_MASK" ? "لم أستطع عزل العنصر. المس مكانًا آخر داخل العنصر الرئيسي." : "تعذر تشغيل تأثير العمق على هذا الجهاز. تأكد من الاتصال وحاول مجددًا.");
    }
  }

  /* ----------------------------------- التصدير والتعيين ----------------------------------- */
  async function exportBlob(): Promise<Blob> {
    const img = imgRef.current;
    if (!img || !img.complete || !img.naturalWidth) throw new Error("IMAGE_NOT_READY");
    const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const W = Math.round(img.naturalWidth * scale);
    const H = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("CANVAS_UNAVAILABLE");

    if (blur) {
      // تغبيش متوافق مع كل المتصفحات (بدون ctx.filter): تصغير ثم تكبير بنعومة.
      const small = document.createElement("canvas");
      small.width = Math.max(8, Math.round(W / 28)); small.height = Math.max(8, Math.round(H / 28));
      small.getContext("2d")?.drawImage(img, 0, 0, small.width, small.height);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(small, -W * 0.04, -H * 0.04, W * 1.08, H * 1.08);
    } else {
      ctx.drawImage(img, 0, 0, W, H);
    }

    const d = now ?? new Date();
    for (const w of widgets) {
      const def = styleOf(w.style);
      const family = VIEWER_FONTS[def.font];
      const px = (def.size * W) / 1000;
      const font = `${def.weight} ${px}px ${family}`;
      try { await document.fonts.load(font, "٠١٢٣ 0123 أبجد abc"); } catch { /* نكمل بالخط البديل */ }
      ctx.save();
      ctx.translate((w.x / 100) * W, (w.y / 100) * H);
      ctx.rotate((w.rot * Math.PI) / 180);
      ctx.scale(w.scale, w.scale);
      ctx.font = font;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = w.color; ctx.strokeStyle = w.color;
      ctx.shadowColor = "rgba(0,0,0,.28)"; ctx.shadowBlur = px * 0.08;
      if (def.ls && "letterSpacing" in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${(def.ls * W) / 1000}px`;
      let lines = def.lines(d, fmt, w.text);
      if (def.kind === "quote") lines = wrapLines(ctx, lines[0] ?? "", W * 0.82);
      const lh = px * def.lh;
      const top = (-(lines.length - 1) * lh) / 2;
      lines.forEach((line, i) => {
        if (def.outline) { ctx.shadowBlur = 0; ctx.lineWidth = Math.max(2, W * 0.005); ctx.strokeText(line, 0, top + i * lh); }
        else ctx.fillText(line, 0, top + i * lh);
      });
      ctx.restore();
    }

    if (depth.status === "ready" && depth.url) {
      const cut = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("CUTOUT_LOAD_FAILED"));
        el.src = depth.url as string;
      });
      ctx.drawImage(cut, 0, 0, W, H);
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("EXPORT_FAILED");
    return blob;
  }

  async function onSetWallpaper() {
    if (!canDownload) { setToast("هذه الخلفية لأعضاء VIP."); return; }
    if (exporting) return;
    setExporting(true);
    setSelected(null);
    try {
      const blob = await exportBlob();
      const file = new File([blob], `gamevortex-${wallpaperId}.png`, { type: "image/png" });
      const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
      if (nav.canShare?.({ files: [file] })) {
        try { await nav.share({ files: [file], title }); return; } catch (error) { if ((error as DOMException)?.name === "AbortError") return; }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setToast("تم حفظ الصورة. افتحها من المعرض ثم اختر «تعيين كخلفية».");
    } catch {
      setToast("تعذر تجهيز الصورة. حاول مرة أخرى.");
    } finally {
      setExporting(false);
    }
  }

  /* ------------------------------------------ العرض ------------------------------------------ */
  const sel = widgets.find((w) => w.id === selected) ?? null;
  const clockNow = now ?? new Date(0);
  const stageStyle = { aspectRatio: String(ratio), width: `min(100%, calc(78dvh * ${ratio}))` } as const;

  function renderWidget(w: Widget, part: "content" | "frame") {
    const def = styleOf(w.style);
    const isFrame = part === "frame";
    const showFrame = isFrame && selected === w.id;
    if (isFrame && !showFrame) return null;
    return (
      <div
        key={`${part}-${w.id}`}
        ref={isFrame ? undefined : (el) => { if (el) widgetRefs.current.set(w.id, el); else widgetRefs.current.delete(w.id); }}
        className={`gvv-w${isFrame ? " is-frame" : ""}`}
        style={{ left: `${w.x}%`, top: `${w.y}%`, transform: `translate(-50%, -50%) rotate(${w.rot}deg)` }}
        onPointerDown={isFrame ? undefined : (e) => begin(e, "move", w)}
      >
        <div className="gvv-w-inner" style={{ transform: `scale(${w.scale})` }}>
          <TextBlock def={def} now={clockNow} fmt={fmt} color={w.color} text={w.text} />
          {showFrame && (
            <>
              <span className="gvv-frame" />
              <button type="button" className="gvv-handle h-tl" style={{ transform: `translate(-50%, -50%) scale(${1 / w.scale})` }} aria-label="تدوير" onPointerDown={(e) => begin(e, "rotate", w)}>↻</button>
              <button type="button" className="gvv-handle h-tr" style={{ transform: `translate(-50%, -50%) scale(${1 / w.scale})` }} aria-label="حذف" onPointerDown={(e) => { e.stopPropagation(); removeWidget(w.id); }}>✕</button>
              <button type="button" className="gvv-handle h-bl" style={{ transform: `translate(-50%, -50%) scale(${1 / w.scale})` }} aria-label="تكبير وتصغير" onPointerDown={(e) => begin(e, "scale", w)}>⤡</button>
              <button type="button" className="gvv-handle h-br" style={{ transform: `translate(-50%, -50%) scale(${1 / w.scale})` }} aria-label="نسخ" onPointerDown={(e) => { e.stopPropagation(); const copy = { ...w, id: newId(), x: clamp(w.x + 6, 0, 100), y: clamp(w.y + 6, 0, 100) }; setWidgets((l) => [...l, copy]); setSelected(copy.id); }}>＋</button>
            </>
          )}
        </div>
      </div>
    );
  }

  const stageHint = depth.status === "pick" ? "المس العنصر الرئيسي في الصورة (مبنى، شخص، جبل…) ليظهر النص خلفه." : null;
  const sheetStyles = sheet === "clock" ? CLOCK_STYLES : sheet === "day" ? DAY_STYLES : sheet === "date" ? DATE_STYLES : [];

  return (
    <div className="gvv-root">
      <div ref={stageRef} className={`gvv-stage${depth.status === "pick" ? " is-pick" : ""}`} style={stageStyle} onPointerDown={() => { if (depth.status !== "pick") setSelected(null); }} onClick={onStageClick}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt={title}
          className={`gvv-layer gvv-bg${blur ? " is-blur" : ""}`}
          fetchPriority="high"
          draggable={false}
          onLoad={(e) => { const t = e.currentTarget; if (t.naturalWidth && t.naturalHeight) setRatio(t.naturalWidth / t.naturalHeight); }}
        />
        <div className="gvv-widgets">{widgets.map((w) => renderWidget(w, "content"))}</div>
        {depth.status === "ready" && depth.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={depth.url} alt="" className="gvv-layer" draggable={false} />
        )}
        <div className="gvv-widgets" style={{ zIndex: 4 }}>{widgets.map((w) => renderWidget(w, "frame"))}</div>

        <button type="button" className={`gvv-depth-btn${depth.status === "ready" || depth.status === "pick" ? " on" : ""}`} onClick={(e) => { e.stopPropagation(); toggleDepth(); }} onPointerDown={(e) => e.stopPropagation()} aria-label="تأثير العمق" title="تأثير العمق">✦</button>
        {stageHint && <div className="gvv-hint">{stageHint}</div>}
        {depth.status === "working" && <div className="gvv-busy">جارٍ عزل العنصر… (أول مرة قد تستغرق ثواني)</div>}
      </div>

      {sel && (
        <div className="gvv-colors" role="group" aria-label="لون العنصر">
          {COLORS.map((c) => <button key={c} type="button" className={`gvv-swatch${sel.color.toLowerCase() === c ? " on" : ""}`} style={{ background: c }} aria-label={`لون ${c}`} onClick={() => patch(sel.id, { color: c })} />)}
          <input className="gvv-color-input" type="color" value={/^#[0-9a-f]{6}$/i.test(sel.color) ? sel.color : "#ffffff"} onChange={(e) => patch(sel.id, { color: e.target.value })} aria-label="لون مخصص" />
        </div>
      )}

      <nav className="gvv-bar" aria-label="أدوات الخلفية">
        <button type="button" className="gvv-act" onClick={onSetWallpaper} aria-disabled={exporting}><span className="ico"><Icon name="set" /></span>{exporting ? "جارٍ…" : "تعيين"}</button>
        {canDownload ? (
          <a className="gvv-act" href={`/api/wallpapers/${wallpaperId}/download`}><span className="ico"><Icon name="download" /></span>تنزيل</a>
        ) : (
          <Link className="gvv-act" href="/vip"><span className="ico"><Icon name="download" /></span>VIP</Link>
        )}
        <button type="button" className={`gvv-act${sheet === "quote" ? " on" : ""}`} onClick={() => openSheet("quote")}><span className="ico"><Icon name="quote" /></span>اقتباس</button>
        <button type="button" className={`gvv-act${sheet && sheet !== "quote" ? " on" : ""}`} onClick={() => openSheet("clock")}><span className="ico"><Icon name="tools" /></span>أدوات</button>
        <button type="button" className={`gvv-act${blur ? " on" : ""}`} onClick={() => setBlur((b) => !b)} aria-pressed={blur}><span className="ico"><Icon name="blur" /></span>تغبيش</button>
      </nav>

      {sheet && (
        <div className="gvv-backdrop" onClick={() => setSheet(null)}>
          <div className="gvv-sheet" role="dialog" aria-label="الأدوات" onClick={(e) => e.stopPropagation()}>
            <div className="gvv-grip" />
            <div className="gvv-tabs" role="tablist">
              {SHEET_TABS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={sheet === key} className={`gvv-tab${sheet === key ? " on" : ""}`} onClick={() => setSheet(key)}>{label}</button>)}
            </div>

            {sheet !== "quote" && (
              <>
                <div className="gvv-row">
                  <button type="button" className={`gvv-chip${fmt.h12 ? " on" : ""}`} onClick={() => setFmt((f) => ({ ...f, h12: !f.h12 }))}>نظام 12 ساعة</button>
                  <button type="button" className={`gvv-chip${fmt.arab ? " on" : ""}`} onClick={() => setFmt((f) => ({ ...f, arab: !f.arab }))}>أرقام هندية ٠١٢</button>
                </div>
                <div className={`gvv-grid${sheet === "clock" ? " cols3" : ""}`}>
                  {sheetStyles.map((def) => (
                    <button key={def.key} type="button" className={`gvv-card${sel?.style === def.key ? " on" : ""}`} onClick={() => applyStyle(def)} aria-label={def.key}>
                      <TextBlock def={def} now={clockNow} fmt={fmt} color="#ffffff" factor={sheet === "clock" ? 0.8 : 0.5} />
                    </button>
                  ))}
                </div>
              </>
            )}

            {sheet === "quote" && (
              <>
                <textarea className="gvv-textarea" dir="auto" maxLength={160} value={quoteText} onChange={(e) => setQuoteText(e.target.value)} placeholder="اكتب اقتباسك هنا…" />
                <div className="gvv-row">{QUICK_QUOTES.map((q) => <button key={q} type="button" className="gvv-chip" onClick={() => setQuoteText(q)}>{q}</button>)}</div>
                <div className="gvv-row">{QUOTE_STYLES.map((s) => <button key={s.key} type="button" className={`gvv-chip${quoteStyle === s.key ? " on" : ""}`} style={{ fontFamily: VIEWER_FONTS[s.font] }} onClick={() => setQuoteStyle(s.key)}>{QUOTE_LABELS[s.key] ?? s.key}</button>)}</div>
                <button type="button" className="gvv-primary" onClick={submitQuote}>{sel?.kind === "quote" ? "تحديث الاقتباس" : "إضافة الاقتباس"}</button>
              </>
            )}
          </div>
        </div>
      )}

      {toast && <div className="gvv-toast" role="status">{toast}</div>}
    </div>
  );
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}
