/**
 * رسم مشهد Wallpaper Studio على Canvas. دوال نقية بلا React:
 * نفس الدالة ترسم المعاينة وترسم التصدير النهائي، فلا تختلف النتيجتان.
 * عناصر واجهة المحرر (إطار التحديد) تُرسم على Canvas منفصل ولا تدخل الصورة المصدّرة.
 */
import {
  STUDIO_FONTS,
  STUDIO_H,
  STUDIO_W,
  type StudioEffectKey,
  type StudioLayer,
} from "@/lib/wallpaper-studio-policy";

export type SceneBackground = { source: CanvasImageSource; width: number; height: number } | null;

export type TemplateOverlay = { top: string; bottom: string };

/* -------------------------------------------------------------------------- */
/* نصوص الساعة والتاريخ (تُحسب وقت الرسم فتكون دائمًا صحيحة عند التصدير)       */
/* -------------------------------------------------------------------------- */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = formatterCache.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, options);
    formatterCache.set(key, found);
  }
  return found;
}

export function isAutoKind(kind: StudioLayer["kind"]): boolean {
  return kind === "clock" || kind === "gregorian" || kind === "hijri";
}

export function resolveLayerText(layer: StudioLayer, now: Date): string {
  if (!layer.auto || !isAutoKind(layer.kind)) return layer.text;
  const arab = layer.digits === "arab";
  try {
    if (layer.kind === "clock") {
      return formatter(arab ? "ar-EG-u-nu-arab" : "en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: layer.clockFormat === "12",
      }).format(now);
    }
    if (layer.kind === "gregorian") {
      if (arab) {
        return formatter("ar-EG-u-ca-gregory-nu-arab", { weekday: "long", day: "numeric", month: "long", ...(layer.dateStyle === "long" ? { year: "numeric" } : {}) }).format(now);
      }
      const text = formatter("en-US", layer.dateStyle === "long"
        ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
        : { weekday: "short", day: "numeric", month: "short" }).format(now);
      return layer.dateStyle === "long" ? text : text.toUpperCase();
    }
    // hijri
    return formatter(`ar-SA-u-ca-islamic-umalqura-nu-${arab ? "arab" : "latn"}`, {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(now);
  } catch {
    return layer.text;
  }
}

/* -------------------------------------------------------------------------- */
/* خطوط وقياسات                                                                */
/* -------------------------------------------------------------------------- */

const ARABIC = /[؀-ۿݐ-ݿ]/;
const LINE_HEIGHT = 1.25;

function applyFont(ctx: CanvasRenderingContext2D, layer: StudioLayer, text: string) {
  ctx.font = `${layer.weight} ${layer.fontSize}px ${STUDIO_FONTS[layer.fontFamily].stack}`;
  ctx.direction = ARABIC.test(text) ? "rtl" : "ltr";
  ctx.textBaseline = "middle";
  ctx.textAlign = layer.align;
}

/** صندوق الطبقة في إحداثياتها المحلية (قبل scale/rotation). */
export function layerBox(ctx: CanvasRenderingContext2D, layer: StudioLayer, text: string) {
  ctx.save();
  applyFont(ctx, layer, text);
  const lines = text.split("\n");
  const width = Math.max(1, ...lines.map((line) => ctx.measureText(line).width));
  ctx.restore();
  const height = lines.length * layer.fontSize * LINE_HEIGHT;
  const left = layer.align === "left" ? 0 : layer.align === "right" ? -width : -width / 2;
  return { left, top: -height / 2, width, height };
}

/** هل النقطة (بإحداثيات اللوحة) داخل الطبقة؟ */
export function hitLayer(ctx: CanvasRenderingContext2D, layer: StudioLayer, text: string, x: number, y: number, pad = 24): boolean {
  const rad = (-layer.rotation * Math.PI) / 180;
  const dx = x - layer.x;
  const dy = y - layer.y;
  const lx = (dx * Math.cos(rad) - dy * Math.sin(rad)) / layer.scale;
  const ly = (dx * Math.sin(rad) + dy * Math.cos(rad)) / layer.scale;
  const box = layerBox(ctx, layer, text);
  const slack = pad / layer.scale;
  return lx >= box.left - slack && lx <= box.left + box.width + slack && ly >= box.top - slack && ly <= box.top + box.height + slack;
}

/* -------------------------------------------------------------------------- */
/* الرسم                                                                       */
/* -------------------------------------------------------------------------- */

let noiseCanvas: HTMLCanvasElement | null = null;

function noisePattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (!noiseCanvas) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const nctx = c.getContext("2d");
    if (!nctx) return null;
    const image = nctx.createImageData(256, 256);
    for (let i = 0; i < image.data.length; i += 4) {
      const v = Math.random() * 255;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
    nctx.putImageData(image, 0, 0);
    noiseCanvas = c;
  }
  return ctx.createPattern(noiseCanvas, "repeat");
}

function drawBackground(ctx: CanvasRenderingContext2D, bg: SceneBackground) {
  const grad = ctx.createLinearGradient(0, 0, STUDIO_W, STUDIO_H);
  grad.addColorStop(0, "#111827");
  grad.addColorStop(1, "#020617");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, STUDIO_W, STUDIO_H);
  if (!bg || !bg.width || !bg.height) return;
  // cover: تغطية كاملة مع قص الزائد من المنتصف
  const scale = Math.max(STUDIO_W / bg.width, STUDIO_H / bg.height);
  const w = bg.width * scale;
  const h = bg.height * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bg.source, (STUDIO_W - w) / 2, (STUDIO_H - h) / 2, w, h);
}

function drawEffect(ctx: CanvasRenderingContext2D, effect: StudioEffectKey) {
  switch (effect) {
    case "dim":
      ctx.fillStyle = "rgba(0,0,0,.34)";
      ctx.fillRect(0, 0, STUDIO_W, STUDIO_H);
      break;
    case "blue":
      ctx.fillStyle = "rgba(25,80,150,.28)";
      ctx.fillRect(0, 0, STUDIO_W, STUDIO_H);
      break;
    case "vignette": {
      const g = ctx.createRadialGradient(STUDIO_W / 2, STUDIO_H / 2, 250, STUDIO_W / 2, STUDIO_H / 2, 1050);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,.76)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, STUDIO_W, STUDIO_H);
      break;
    }
    case "fade": {
      const g = ctx.createLinearGradient(0, STUDIO_H * 0.45, 0, STUDIO_H);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,.82)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, STUDIO_W, STUDIO_H);
      break;
    }
    case "light": {
      const g = ctx.createRadialGradient(STUDIO_W / 2, STUDIO_H * 0.35, 0, STUDIO_W / 2, STUDIO_H * 0.35, 900);
      g.addColorStop(0, "rgba(255,255,255,.32)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, STUDIO_W, STUDIO_H);
      break;
    }
    case "grain": {
      const pattern = noisePattern(ctx);
      if (!pattern) break;
      ctx.save();
      ctx.globalAlpha = 0.14;
      ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, STUDIO_W, STUDIO_H);
      ctx.restore();
      break;
    }
    default:
      break;
  }
}

export function drawLayer(ctx: CanvasRenderingContext2D, layer: StudioLayer, text: string) {
  ctx.save();
  ctx.translate(layer.x, layer.y);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.scale(layer.scale, layer.scale);
  ctx.globalAlpha = layer.opacity;
  ctx.fillStyle = layer.color;
  applyFont(ctx, layer, text);
  const lines = text.split("\n");
  const lineHeight = layer.fontSize * LINE_HEIGHT;
  const startY = -((lines.length - 1) * lineHeight) / 2;
  if (layer.glow) {
    ctx.shadowColor = layer.color;
    ctx.shadowBlur = 42;
  } else if (layer.shadow > 0) {
    ctx.shadowColor = "rgba(0,0,0,.6)";
    ctx.shadowBlur = layer.shadow;
    ctx.shadowOffsetY = layer.shadow / 4;
  }
  lines.forEach((line, index) => ctx.fillText(line, 0, startY + index * lineHeight));
  ctx.restore();
}

export type SceneOptions = {
  background: SceneBackground;
  overlay: TemplateOverlay;
  effect: StudioEffectKey;
  layers: StudioLayer[];
  now: Date;
};

export function drawScene(ctx: CanvasRenderingContext2D, options: SceneOptions) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, STUDIO_W, STUDIO_H);
  drawBackground(ctx, options.background);

  const tint = ctx.createLinearGradient(0, 0, 0, STUDIO_H);
  tint.addColorStop(0, options.overlay.top);
  tint.addColorStop(1, options.overlay.bottom);
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, STUDIO_W, STUDIO_H);

  drawEffect(ctx, options.effect);

  for (const layer of options.layers) {
    if (!layer.visible) continue;
    drawLayer(ctx, layer, resolveLayerText(layer, options.now));
  }
}

/** إطار التحديد: يُرسم على Canvas علوي منفصل ولا يدخل التصدير أبدًا. */
export function drawSelection(ctx: CanvasRenderingContext2D, layer: StudioLayer | null, text: string) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, STUDIO_W, STUDIO_H);
  if (!layer) return;
  const box = layerBox(ctx, layer, text);
  ctx.save();
  ctx.translate(layer.x, layer.y);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.scale(layer.scale, layer.scale);
  ctx.strokeStyle = "#67e8f9";
  ctx.lineWidth = 3 / layer.scale;
  ctx.setLineDash([14 / layer.scale, 10 / layer.scale]);
  const pad = 12;
  ctx.strokeRect(box.left - pad, box.top - pad, box.width + pad * 2, box.height + pad * 2);
  ctx.restore();
}
