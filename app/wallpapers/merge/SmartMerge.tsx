"use client";

import { ChangeEvent, MouseEvent, useEffect, useRef, useState } from "react";

const W = 1080;
const H = 1920;
const MAX_IMAGES = 6;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MEDIAPIPE_VERSION = "1.0.1";
const SEGMENTER_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const SEGMENTER_MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";
const INTERACTIVE_SEGMENTER_MODEL = "https://storage.googleapis.com/mediapipe-models/interactive_segmenter_v2/magic_touch/int8/latest/interactive_segmentation.task";

type Item = { id: string; name: string; url: string; file: File; cutout: boolean };
type Layout = "stack" | "grid" | "hero";
type CategoryMask = { width: number; height: number; getAsUint8Array(): Uint8Array };
type ConfidenceMask = { width: number; height: number; getAsFloat32Array(): Float32Array };
type Segmenter = { segment: (image: HTMLImageElement) => { categoryMask?: CategoryMask } };
type InteractiveSegmenter = {
  setImage: (image: HTMLImageElement) => void;
  segment: (strokes: Array<{ brushMode: number; point: Array<{ x: number; y: number }>; isCompleted: boolean }>) => ConfidenceMask;
};

let segmenterPromise: Promise<Segmenter> | null = null;
let interactiveSegmenterPromise: Promise<InteractiveSegmenter> | null = null;

function uid() {
  return crypto.randomUUID();
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
    image.src = url;
  });
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function getSegmenter(): Promise<Segmenter> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(SEGMENTER_WASM);
      return ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: SEGMENTER_MODEL },
        runningMode: "IMAGE",
        outputCategoryMask: true,
      }) as unknown as Segmenter;
    })();
  }
  return segmenterPromise;
}

async function getInteractiveSegmenter(): Promise<InteractiveSegmenter> {
  if (!interactiveSegmenterPromise) {
    interactiveSegmenterPromise = (async () => {
      const { FilesetResolver, InteractiveSegmenter, BrushMode } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(SEGMENTER_WASM);
      const instance = await InteractiveSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: INTERACTIVE_SEGMENTER_MODEL },
      });
      return {
        setImage: (image) => instance.setImage(image),
        segment: (strokes) => instance.segment(strokes.map((stroke) => ({ ...stroke, brushMode: BrushMode.POSITIVE }))) as unknown as ConfidenceMask,
      };
    })();
  }
  return interactiveSegmenterPromise;
}

async function maskToCutout(file: File, mask: CategoryMask | ConfidenceMask, confidence = false): Promise<Blob> {
  const image = await loadImageFromFile(file);
  const output = document.createElement("canvas");
  output.width = image.naturalWidth;
  output.height = image.naturalHeight;
  const outputCtx = output.getContext("2d");
  if (!outputCtx) throw new Error("CANVAS_UNAVAILABLE");
  outputCtx.drawImage(image, 0, 0);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = mask.width;
  maskCanvas.height = mask.height;
  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) throw new Error("CANVAS_UNAVAILABLE");

  const pixels = new Uint8ClampedArray(mask.width * mask.height * 4);
  if (confidence) {
    const data = (mask as ConfidenceMask).getAsFloat32Array();
    for (let i = 0; i < data.length; i += 1) {
      const alpha = Math.round(Math.max(0, Math.min(1, data[i])) * 255);
      const offset = i * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = alpha;
    }
  } else {
    const data = (mask as CategoryMask).getAsUint8Array();
    for (let i = 0; i < data.length; i += 1) {
      const offset = i * 4;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = data[i] > 0 ? 255 : 0;
    }
  }
  maskCtx.putImageData(new ImageData(pixels, mask.width, mask.height), 0, 0);

  outputCtx.globalCompositeOperation = "destination-in";
  outputCtx.drawImage(maskCanvas, 0, 0, output.width, output.height);
  outputCtx.globalCompositeOperation = "source-over";

  const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/png", 1));
  if (!blob) throw new Error("CUTOUT_EXPORT_FAILED");
  return blob;
}

async function makeCutout(file: File): Promise<Blob> {
  const image = await loadImageFromFile(file);
  const segmenter = await getSegmenter();
  const result = segmenter.segment(image);
  if (!result.categoryMask) throw new Error("SEGMENTATION_MASK_MISSING");
  return maskToCutout(file, result.categoryMask);
}

async function makeInteractiveCutout(file: File, x: number, y: number): Promise<Blob> {
  const image = await loadImageFromFile(file);
  const segmenter = await getInteractiveSegmenter();
  segmenter.setImage(image);
  const mask = segmenter.segment([{ brushMode: 0, point: [{ x, y }], isCompleted: true }]);
  return maskToCutout(file, mask, true);
}

export default function SmartMerge() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef<Item[]>([]);
  const [layout, setLayout] = useState<Layout>("hero");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [cuttingId, setCuttingId] = useState<string | null>(null);
  const [interactiveId, setInteractiveId] = useState<string | null>(null);
  const [interactiveBusy, setInteractiveBusy] = useState(false);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => () => {
    itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
  }, []);

  async function addImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("image/"));
    event.target.value = "";
    if (!files.length) return;

    const remaining = Math.max(0, MAX_IMAGES - itemsRef.current.length);
    const candidates = files.slice(0, remaining).filter((file) => file.size <= MAX_FILE_BYTES);
    if (!candidates.length) {
      setStatus("لم تتم إضافة الصور: تأكد من أن حجم كل صورة لا يتجاوز 15MB.");
      return;
    }

    setStatus("جاري التحقق من الصور قبل إضافتها...");
    const next: Item[] = [];
    let rejected = 0;
    for (const file of candidates) {
      const previewUrl = URL.createObjectURL(file);
      try {
        await loadImage(previewUrl);
        next.push({ id: uid(), name: file.name, url: previewUrl, file, cutout: false });
      } catch {
        URL.revokeObjectURL(previewUrl);
        rejected += 1;
      }
    }

    if (!next.length) {
      setStatus("تعذر قراءة الصور. اختر JPG أو PNG أو WebP من الهاتف.");
      return;
    }

    setItems((current) => [...current, ...next].slice(0, MAX_IMAGES));
    setStatus(rejected ? `تمت إضافة ${next.length} صورة، وتم تجاهل ${rejected} صورة غير قابلة للعرض.` : `تمت إضافة ${next.length} صورة.`);
  }

  function recoverPreview(id: string, event: React.SyntheticEvent<HTMLImageElement>) {
    const item = itemsRef.current.find((candidate) => candidate.id === id);
    if (!item) return;
    const replacement = URL.createObjectURL(item.file);
    URL.revokeObjectURL(item.url);
    setItems((current) => current.map((candidate) => candidate.id === id ? { ...candidate, url: replacement } : candidate));
    event.currentTarget.src = replacement;
  }

  function remove(id: string) {
    setItems((current) => {
      const found = current.find((item) => item.id === id);
      if (found) URL.revokeObjectURL(found.url);
      return current.filter((item) => item.id !== id);
    });
    if (interactiveId === id) setInteractiveId(null);
  }

  function replaceWithCutout(id: string, blob: Blob, mode: "auto" | "interactive") {
    const item = itemsRef.current.find((candidate) => candidate.id === id);
    if (!item) return;
    const file = new File([blob], `${item.name.replace(/\.[^.]+$/, "")}-cutout.png`, { type: "image/png" });
    const url = URL.createObjectURL(file);
    URL.revokeObjectURL(item.url);
    setItems((current) => current.map((candidate) => candidate.id === id ? { ...candidate, file, url, cutout: true } : candidate));
    setStatus(mode === "interactive" ? "تم عزل العنصر المحدد. الآن يمكنك دمجه مع بقية الصور." : "تم عزل العنصر. الآن يمكنك دمجه مع بقية الصور.");
  }

  async function cutout(id: string) {
    const item = itemsRef.current.find((candidate) => candidate.id === id);
    if (!item || item.cutout) return;
    setCuttingId(id);
    setStatus("AI يعزل العنصر من الصورة محليًا على جهازك...");
    try {
      await replaceWithCutout(id, await makeCutout(item.file), "auto");
    } catch (error) {
      console.error("GameVortex local AI cutout failed", error);
      setStatus("تعذر العزل التلقائي. استخدم «تحديد AI» وحدد العنصر يدويًا.");
    } finally {
      setCuttingId(null);
    }
  }

  async function interactiveCutout(id: string, event: MouseEvent<HTMLImageElement>) {
    const item = itemsRef.current.find((candidate) => candidate.id === id);
    if (!item || interactiveBusy) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    setInteractiveBusy(true);
    setStatus("AI يحدد العنصر الذي ضغطت عليه...");
    try {
      await replaceWithCutout(id, await makeInteractiveCutout(item.file, x, y), "interactive");
      setInteractiveId(null);
    } catch (error) {
      console.error("GameVortex interactive AI cutout failed", error);
      setStatus("تعذر تحديد العنصر. جرّب الضغط في منتصف العنصر المطلوب.");
    } finally {
      setInteractiveBusy(false);
    }
  }

  async function merge() {
    if (items.length < 2) {
      setStatus("أضف صورتين على الأقل أولًا.");
      return;
    }
    setBusy(true);
    setStatus("جاري تركيب الصور وتجهيز Wallpaper بدقة 1080×1920...");
    try {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) throw new Error("CANVAS_UNAVAILABLE");
      ctx.clearRect(0, 0, W, H);

      const gradient = ctx.createLinearGradient(0, 0, 0, H);
      gradient.addColorStop(0, "#080b14");
      gradient.addColorStop(1, "#020308");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, W, H);

      const loaded = await Promise.all(items.map((item) => loadImageFromFile(item.file)));
      const cutoutIndexes = items.map((item, index) => item.cutout ? index : -1).filter((index) => index >= 0);

      const drawCover = (image: HTMLImageElement, x: number, y: number, w: number, h: number, radius = 34) => {
        const scale = Math.max(w / image.width, h / image.height);
        const iw = image.width * scale;
        const ih = image.height * scale;
        const dx = x + (w - iw) / 2;
        const dy = y + (h - ih) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, radius);
        ctx.clip();
        ctx.drawImage(image, dx, dy, iw, ih);
        ctx.restore();
      };

      const drawContain = (image: HTMLImageElement, x: number, y: number, w: number, h: number) => {
        const scale = Math.min(w / image.width, h / image.height);
        const iw = image.width * scale;
        const ih = image.height * scale;
        const dx = x + (w - iw) / 2;
        const dy = y + (h - ih) / 2;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,.65)";
        ctx.shadowBlur = 34;
        ctx.shadowOffsetY = 18;
        ctx.drawImage(image, dx, dy, iw, ih);
        ctx.restore();
      };

      if (cutoutIndexes.length > 0) {
        const backgroundIndex = items.findIndex((item) => !item.cutout);
        if (backgroundIndex >= 0) drawCover(loaded[backgroundIndex], 24, 24, W - 48, H - 48, 44);
        const glow = ctx.createRadialGradient(W / 2, H * 0.48, 40, W / 2, H * 0.48, W * 0.65);
        glow.addColorStop(0, "rgba(180,90,255,.7)");
        glow.addColorStop(1, "rgba(20,10,40,0)");
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        cutoutIndexes.slice(0, 5).forEach((index, overlayIndex) => {
          const primary = overlayIndex === 0;
          const boxW = primary ? W * 0.84 : W * 0.34;
          const boxH = primary ? H * 0.78 : H * 0.34;
          const x = primary ? W * 0.08 : 34 + ((overlayIndex - 1) % 3) * (W * 0.31);
          const y = primary ? H * 0.11 : H * 0.64;
          drawContain(loaded[index], x, y, boxW, boxH);
        });
        const vignette = ctx.createLinearGradient(0, 0, 0, H);
        vignette.addColorStop(0, "rgba(0,0,0,.04)");
        vignette.addColorStop(0.62, "rgba(0,0,0,.02)");
        vignette.addColorStop(1, "rgba(0,0,0,.48)");
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, W, H);
      } else if (layout === "hero") {
        drawCover(loaded[0], 30, 30, W - 60, H - 60, 46);
        loaded.slice(1, 4).forEach((image, index) => drawCover(image, 55 + index * 340, H - 500, 300, 420, 32));
      } else if (layout === "grid") {
        const gap = 24;
        const cols = 2;
        const cellW = (W - gap * 3) / cols;
        const cellH = 560;
        loaded.slice(0, 6).forEach((image, index) => {
          const col = index % cols;
          const row = Math.floor(index / cols);
          drawCover(image, gap + col * (cellW + gap), gap + row * (cellH + gap), cellW, cellH, 32);
        });
      } else {
        const gap = 24;
        const cellW = W - gap * 2;
        const cellH = Math.min(430, (H - gap * (loaded.length + 1)) / Math.max(loaded.length, 1));
        loaded.forEach((image, index) => drawCover(image, gap, gap + index * (cellH + gap), cellW, cellH, 32));
      }
      setStatus("تم الدمج الاحترافي. النتيجة جاهزة للتنزيل أو المتابعة داخل Wallpaper Studio.");
    } catch (error) {
      console.error("GameVortex smart merge failed", error);
      setStatus("تعذر قراءة إحدى الصور. أعد اختيار الصور من الهاتف ثم حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png", 1));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "gamevortex-smart-merge-1080x1920.png";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className="wrap" dir="rtl" style={{ maxWidth: 1180, paddingBottom: 48 }}>
      <section className="glass hero" style={{ padding: 20 }}>
        <p className="muted" style={{ margin: 0 }}>GAMEVORTEX SMART MERGE</p>
        <h1 style={{ margin: "6px 0" }}>ادمج صورك بذكاء في Wallpaper واحد</h1>
        <p className="muted" style={{ margin: 0 }}>ارفع صورك، استخدم العزل المحلي بالذكاء الاصطناعي عند الحاجة، ثم ركبها داخل Wallpaper بدقة 1080×1920.</p>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 18, marginTop: 18, alignItems: "start" }}>
        <div className="glass card" style={{ padding: 16, display: "grid", placeItems: "center" }}>
          <div style={{ width: "min(100%, 390px)", background: "#07090d", padding: 7, borderRadius: 34 }}>
            <canvas ref={canvasRef} width={W} height={H} aria-label="معاينة Wallpaper المدمج" style={{ display: "block", width: "100%", height: "auto", borderRadius: 28 }} />
          </div>
        </div>

        <aside className="glass card" style={{ padding: 16 }}>
          <input id="smart-merge-images" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple hidden onChange={addImages} />
          <label htmlFor="smart-merge-images" className="btn" style={{ display: "block", textAlign: "center", cursor: "pointer" }}>+ إضافة صور من الهاتف</label>
          <p className="muted" style={{ fontSize: 13 }}>حتى 6 صور، بحد أقصى 15MB للصورة. المعالجة الذكية تتم محليًا ولا تحتاج API Key.</p>

          <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
            <strong>طريقة الدمج</strong>
            {(["hero", "grid", "stack"] as Layout[]).map((value) => (
              <button key={value} className={`platform-chip ${layout === value ? "active" : ""}`} onClick={() => setLayout(value)}>
                {value === "hero" ? "صورة رئيسية + صور جانبية" : value === "grid" ? "شبكة احترافية" : "صور متتالية"}
              </button>
            ))}
          </div>

          <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
            {items.map((item, index) => (
              <div key={item.id} style={{ display: "grid", gridTemplateColumns: "48px minmax(0, 1fr) auto", alignItems: "center", gap: 8, padding: 8, borderRadius: 12, background: "rgba(255,255,255,.05)" }}>
                <button type="button" onClick={() => setInteractiveId(item.id)} title="حدد العنصر داخل الصورة باستخدام AI" style={{ padding: 0, border: 0, background: "transparent", cursor: "pointer", borderRadius: 8, overflow: "hidden" }}>
                  <img src={item.url} onError={(event) => recoverPreview(item.id, event)} alt="" width={48} height={64} style={{ display: "block", objectFit: "cover", borderRadius: 8 }} />
                </button>
                <span style={{ minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{index + 1}. {item.name}{item.cutout ? " • معزولة" : ""}</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button className="btn secondary" disabled={cuttingId !== null || interactiveBusy} onClick={() => cutout(item.id)}>{cuttingId === item.id ? "AI..." : item.cutout ? "معزولة" : "عزل AI"}</button>
                  <button className="btn secondary" disabled={interactiveBusy} onClick={() => setInteractiveId(item.id)}>تحديد AI</button>
                  <button className="btn secondary" onClick={() => remove(item.id)}>حذف</button>
                </div>
              </div>
            ))}
          </div>

          <button className="btn" style={{ width: "100%", marginTop: 16 }} disabled={busy || items.length < 2} onClick={merge}>{busy ? "جاري الدمج..." : "دمج الصور"}</button>
          <button className="btn secondary" style={{ width: "100%", marginTop: 8 }} onClick={download}>تنزيل 1080×1920</button>
          {status && <p role="status" className="muted" style={{ marginTop: 12 }}>{status}</p>}
        </aside>
      </section>

      {interactiveId && (() => {
        const item = items.find((candidate) => candidate.id === interactiveId);
        if (!item) return null;
        return (
          <div role="dialog" aria-modal="true" aria-label="تحديد عنصر بالذكاء الاصطناعي" style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.78)", display: "grid", placeItems: "center", padding: 18 }}>
            <div className="glass card" style={{ width: "min(94vw, 620px)", maxHeight: "92vh", overflow: "auto", padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                <div>
                  <strong>تحديد AI</strong>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>اضغط على العنصر الذي تريد عزله. المعالجة تتم محليًا على جهازك.</p>
                </div>
                <button className="btn secondary" onClick={() => setInteractiveId(null)} disabled={interactiveBusy}>إغلاق</button>
              </div>
              <div style={{ marginTop: 14, position: "relative", display: "grid", placeItems: "center", background: "#05060a", borderRadius: 18, overflow: "hidden" }}>
                <img src={item.url} onError={(event) => recoverPreview(item.id, event)} alt="اختر العنصر المطلوب عزله" onClick={(event) => interactiveCutout(item.id, event)} style={{ display: "block", maxWidth: "100%", maxHeight: "68vh", width: "auto", height: "auto", cursor: interactiveBusy ? "wait" : "crosshair", userSelect: "none" }} />
              </div>
              <p className="muted" style={{ margin: "10px 0 0", textAlign: "center", fontSize: 13 }}>{interactiveBusy ? "جاري عزل العنصر..." : "اضغط مرة واحدة على منتصف العنصر المطلوب."}</p>
            </div>
          </div>
        );
      })()}
    </main>
  );
}
