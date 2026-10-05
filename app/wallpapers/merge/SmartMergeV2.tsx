"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";

const W = 1080;
const H = 1920;
const MAX_IMAGES = 6;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const SEGMENTER_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const SEGMENTER_MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

type Item = { id: string; name: string; url: string; file: File; cutout: boolean };
type Layout = "stack" | "grid" | "hero";
type Mask = { width: number; height: number; getAsUint8Array(): Uint8Array };
type SegmentationResult = { categoryMask?: Mask };
type Segmenter = { segment: (image: HTMLImageElement, callback: (result: SegmentationResult) => void) => void };

let segmenterPromise: Promise<Segmenter> | null = null;

function uid() {
  return crypto.randomUUID();
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
        outputConfidenceMasks: false,
      }) as unknown as Segmenter;
    })();
  }
  return segmenterPromise;
}

async function makeCutout(file: File): Promise<Blob> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = sourceUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("IMAGE_LOAD_FAILED"));
    });

    const segmenter = await getSegmenter();
    const result = await new Promise<SegmentationResult>((resolve, reject) => {
      try {
        segmenter.segment(image, resolve);
      } catch (error) {
        reject(error);
      }
    });
    const mask = result.categoryMask;
    if (!mask) throw new Error("SEGMENTATION_MASK_MISSING");

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
    if (!maskCtx) throw new Error("MASK_CANVAS_UNAVAILABLE");

    const values = mask.getAsUint8Array();
    const pixels = new Uint8ClampedArray(mask.width * mask.height * 4);
    for (let i = 0; i < values.length; i += 1) {
      const offset = i * 4;
      const alpha = values[i] > 0 ? 255 : 0;
      pixels[offset] = 255;
      pixels[offset + 1] = 255;
      pixels[offset + 2] = 255;
      pixels[offset + 3] = alpha;
    }
    maskCtx.putImageData(new ImageData(pixels, mask.width, mask.height), 0, 0);

    outputCtx.globalCompositeOperation = "destination-in";
    outputCtx.drawImage(maskCanvas, 0, 0, output.width, output.height);
    outputCtx.globalCompositeOperation = "source-over";

    const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/png", 1));
    if (!blob) throw new Error("CUTOUT_EXPORT_FAILED");
    return blob;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export default function SmartMergeV2() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [layout, setLayout] = useState<Layout>("hero");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [cuttingId, setCuttingId] = useState<string | null>(null);

  useEffect(() => () => items.forEach((item) => URL.revokeObjectURL(item.url)), [items]);

  function addImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("image/"));
    const accepted = files.slice(0, MAX_IMAGES).filter((file) => file.size <= MAX_FILE_BYTES);
    if (!accepted.length) return;
    const next = accepted.map((file) => ({ id: uid(), name: file.name, url: URL.createObjectURL(file), file, cutout: false }));
    setItems((current) => [...current, ...next].slice(0, MAX_IMAGES));
    setStatus(`${next.length} صورة أضيفت.`);
    event.target.value = "";
  }

  function remove(id: string) {
    setItems((current) => {
      const found = current.find((item) => item.id === id);
      if (found) URL.revokeObjectURL(found.url);
      return current.filter((item) => item.id !== id);
    });
  }

  async function cutout(id: string) {
    const item = items.find((candidate) => candidate.id === id);
    if (!item || item.cutout) return;
    setCuttingId(id);
    setStatus("جاري عزل العنصر بالذكاء الاصطناعي على جهازك...");
    try {
      const blob = await makeCutout(item.file);
      const file = new File([blob], `${item.name.replace(/\.[^.]+$/, "")}-cutout.png`, { type: "image/png" });
      const url = URL.createObjectURL(file);
      setItems((current) => current.map((candidate) => {
        if (candidate.id !== id) return candidate;
        URL.revokeObjectURL(candidate.url);
        return { ...candidate, file, url, cutout: true };
      }));
      setStatus("تم عزل العنصر. يمكنك الآن دمجه مع الصور الأخرى.");
    } catch (error) {
      console.error("GameVortex Smart Merge cutout failed", error);
      setStatus("تعذر العزل التلقائي. استخدم صورة يظهر فيها الشخص بوضوح وخلفيتها غير معقدة.");
    } finally {
      setCuttingId(null);
    }
  }

  async function merge() {
    if (items.length < 2) {
      setStatus("أضف صورتين على الأقل أولًا.");
      return;
    }
    setBusy(true);
    setStatus("جاري تركيب الصور وتجهيز 1080×1920...");
    try {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) throw new Error("CANVAS");
      ctx.clearRect(0, 0, W, H);
      const background = ctx.createLinearGradient(0, 0, 0, H);
      background.addColorStop(0, "#080b14");
      background.addColorStop(1, "#020308");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, W, H);

      const loaded = await Promise.all(items.map(async (item) => {
        const image = new Image();
        image.src = item.url;
        await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("IMAGE")); });
        return image;
      }));

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

      if (layout === "hero") {
        drawCover(loaded[0], 30, 30, W - 60, H - 60, 46);
        loaded.slice(1, 4).forEach((image, index) => drawCover(image, 55 + index * 340, H - 500, 300, 420, 32));
      } else if (layout === "grid") {
        const gap = 24;
        const cellW = (W - gap * 3) / 2;
        const cellH = 560;
        loaded.forEach((image, index) => drawCover(image, gap + (index % 2) * (cellW + gap), gap + Math.floor(index / 2) * (cellH + gap), cellW, cellH, 32));
      } else {
        const gap = 24;
        const cellW = W - gap * 2;
        const cellH = Math.min(430, (H - gap * (loaded.length + 1)) / loaded.length);
        loaded.forEach((image, index) => drawCover(image, gap, gap + index * (cellH + gap), cellW, cellH, 32));
      }

      const shade = ctx.createLinearGradient(0, 0, 0, H);
      shade.addColorStop(0, "rgba(0,0,0,.05)");
      shade.addColorStop(.65, "rgba(0,0,0,.08)");
      shade.addColorStop(1, "rgba(0,0,0,.38)");
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, W, H);
      setStatus("تم الدمج. افتح النتيجة في Wallpaper Studio لإضافة الساعة والاسم والتأثيرات.");
    } catch {
      setStatus("تعذر دمج إحدى الصور. جرّب صورًا أخرى.");
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
    URL.revokeObjectURL(url);
  }

  return (
    <main className="wrap" dir="rtl" style={{ maxWidth: 1180, paddingBottom: 48 }}>
      <section className="glass hero" style={{ padding: 20 }}>
        <p className="muted" style={{ margin: 0 }}>GAMEVORTEX SMART MERGE</p>
        <h1 style={{ margin: "6px 0" }}>ادمج صورك بذكاء في Wallpaper واحد</h1>
        <p className="muted" style={{ margin: 0 }}>ارفع صورك، اعزل الأشخاص عند الحاجة محليًا، ثم ركبها داخل Wallpaper بدقة 1080×1920.</p>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", gap: 18, marginTop: 18, alignItems: "start" }}>
        <div className="glass card" style={{ padding: 16, display: "grid", placeItems: "center" }}>
          <div style={{ width: "min(100%, 390px)", background: "#07090d", padding: 7, borderRadius: 34 }}>
            <canvas ref={canvasRef} width={W} height={H} style={{ display: "block", width: "100%", height: "auto", borderRadius: 28 }} />
          </div>
        </div>

        <aside className="glass card" style={{ padding: 16 }}>
          <input id="smart-merge-images" type="file" accept="image/*" multiple hidden onChange={addImages} />
          <label htmlFor="smart-merge-images" className="btn" style={{ display: "block", textAlign: "center", cursor: "pointer" }}>+ إضافة صور من الهاتف</label>
          <p className="muted" style={{ fontSize: 13 }}>حتى 6 صور، بحد أقصى 15MB للصورة. العزل المحلي لا يحتاج API Key.</p>

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
                <img src={item.url} alt="" width={48} height={64} style={{ objectFit: "cover", borderRadius: 8 }} />
                <span style={{ minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{index + 1}. {item.name}{item.cutout ? " • معزولة" : ""}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn secondary" disabled={cuttingId !== null || item.cutout} onClick={() => cutout(item.id)}>{cuttingId === item.id ? "AI..." : item.cutout ? "معزولة" : "عزل AI"}</button>
                  <button className="btn secondary" onClick={() => remove(item.id)} aria-label={`حذف ${item.name}`}>حذف</button>
                </div>
              </div>
            ))}
          </div>

          <button className="btn" style={{ width: "100%", marginTop: 16 }} disabled={busy || items.length < 2} onClick={merge}>{busy ? "جاري الدمج..." : "دمج الصور"}</button>
          <button className="btn secondary" style={{ width: "100%", marginTop: 8 }} onClick={download}>تنزيل 1080×1920</button>
          {status && <p role="status" className="muted" style={{ marginTop: 12 }}>{status}</p>}
        </aside>
      </section>
    </main>
  );
}
