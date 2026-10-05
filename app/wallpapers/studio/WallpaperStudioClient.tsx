"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type LibraryItem = {
  id: string;
  title: string;
  src: string;
  width: number | null;
  height: number | null;
  isVip: boolean;
};

type Layer = {
  id: string;
  kind: "clock" | "gregorian" | "hijri" | "text" | "overlay";
  text: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  color: string;
  fontSize: number;
  visible: boolean;
};

const W = 1080;
const H = 1920;
const DEFAULT_IMAGE = "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=1080&q=85";

function uid() {
  return crypto.randomUUID();
}

function initialLayers(): Layer[] {
  return [
    { id: uid(), kind: "clock", text: "10:57", x: 540, y: 620, scale: 1, rotation: 0, opacity: 1, color: "#ffffff", fontSize: 170, visible: true },
    { id: uid(), kind: "gregorian", text: "MON 5 OCT", x: 540, y: 790, scale: 1, rotation: 0, opacity: .86, color: "#ffffff", fontSize: 38, visible: true },
    { id: uid(), kind: "hijri", text: "13 ربيع الآخر 1448", x: 540, y: 850, scale: 1, rotation: 0, opacity: .78, color: "#ffffff", fontSize: 30, visible: true },
  ];
}

function formatDates() {
  const now = new Date();
  const gregorian = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short" }).format(now).toUpperCase();
  const hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic", { day: "numeric", month: "long", year: "numeric" }).format(now);
  const clock = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return { gregorian, hijri, clock };
}

export default function WallpaperStudioClient({ library }: { library: LibraryItem[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [background, setBackground] = useState(DEFAULT_IMAGE);
  const [layers, setLayers] = useState<Layer[]>(initialLayers);
  const [selected, setSelected] = useState<string | null>(null);
  const [effect, setEffect] = useState<"none" | "dim" | "grain" | "vignette" | "blue">("none");
  const [activeTab, setActiveTab] = useState<"background" | "tools" | "text" | "effects">("background");
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [history, setHistory] = useState<Layer[][]>([]);
  const [future, setFuture] = useState<Layer[][]>([]);
  const [customText, setCustomText] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const selectedLayer = useMemo(() => layers.find((layer) => layer.id === selected) || null, [layers, selected]);

  useEffect(() => {
    const dates = formatDates();
    setLayers((current) => current.map((layer) => ({
      ...layer,
      text: layer.kind === "clock" ? dates.clock : layer.kind === "gregorian" ? dates.gregorian : layer.kind === "hijri" ? dates.hijri : layer.text,
    })));
  }, []);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, W, H);

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const scale = Math.max(W / image.width, H / image.height);
      const iw = image.width * scale;
      const ih = image.height * scale;
      ctx.drawImage(image, (W - iw) / 2, (H - ih) / 2, iw, ih);
      drawEffects(ctx);
      layers.filter((layer) => layer.visible).forEach((layer) => drawLayer(ctx, layer));
    };
    image.onerror = () => {
      ctx.fillStyle = "#1d2635";
      ctx.fillRect(0, 0, W, H);
      drawEffects(ctx);
      layers.filter((layer) => layer.visible).forEach((layer) => drawLayer(ctx, layer));
    };
    image.src = background;
  };

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [background, layers, effect]);

  function drawEffects(ctx: CanvasRenderingContext2D) {
    if (effect === "dim") {
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fillRect(0, 0, W, H);
    } else if (effect === "blue") {
      ctx.fillStyle = "rgba(25,80,150,.22)";
      ctx.fillRect(0, 0, W, H);
    } else if (effect === "vignette") {
      const g = ctx.createRadialGradient(W / 2, H / 2, 250, W / 2, H / 2, 1100);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,.72)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else if (effect === "grain") {
      const image = ctx.getImageData(0, 0, W, H);
      for (let i = 0; i < image.data.length; i += 4) {
        const noise = (Math.random() - .5) * 22;
        image.data[i] += noise;
        image.data[i + 1] += noise;
        image.data[i + 2] += noise;
      }
      ctx.putImageData(image, 0, 0);
    }
  }

  function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer) {
    ctx.save();
    ctx.translate(layer.x, layer.y);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.globalAlpha = layer.opacity;
    ctx.fillStyle = layer.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `500 ${layer.fontSize * layer.scale}px Arial, sans-serif`;
    if (layer.kind === "clock") ctx.font = `300 ${layer.fontSize * layer.scale}px Arial, sans-serif`;
    if (layer.kind === "text") ctx.font = `600 ${layer.fontSize * layer.scale}px Arial, sans-serif`;
    ctx.shadowColor = "rgba(0,0,0,.45)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 5;
    ctx.fillText(layer.text, 0, 0);
    ctx.restore();
  }

  function commit(next: Layer[]) {
    setHistory((h) => [...h.slice(-29), layers]);
    setFuture([]);
    setLayers(next);
  }

  function updateSelected(patch: Partial<Layer>) {
    if (!selected) return;
    commit(layers.map((layer) => layer.id === selected ? { ...layer, ...patch } : layer));
  }

  function addText() {
    const text = customText.trim();
    if (!text) return;
    const layer: Layer = { id: uid(), kind: "text", text, x: 540, y: 1050, scale: 1, rotation: 0, opacity: 1, color: "#ffffff", fontSize: 58, visible: true };
    commit([...layers, layer]);
    setSelected(layer.id);
    setCustomText("");
  }

  function addPreset(kind: Layer["kind"], text: string) {
    const layer: Layer = { id: uid(), kind, text, x: 540, y: 980, scale: 1, rotation: 0, opacity: 1, color: "#ffffff", fontSize: kind === "clock" ? 150 : 42, visible: true };
    commit([...layers, layer]);
    setSelected(layer.id);
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((f) => [...f, layers]);
    setLayers(previous);
    setHistory((h) => h.slice(0, -1));
  }

  function redo() {
    const next = future.at(-1);
    if (!next) return;
    setHistory((h) => [...h, layers]);
    setLayers(next);
    setFuture((f) => f.slice(0, -1));
  }

  function exportImage() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png", 1);
    setPreviewUrl(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gamevortex-wallpaper-${Date.now()}.png`;
    link.click();
  }

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 15 * 1024 * 1024) {
      window.alert("الصورة أكبر من 15MB. اختر صورة أصغر.");
      return;
    }
    const url = URL.createObjectURL(file);
    setBackground(url);
  }

  function canvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * W, y: ((event.clientY - rect.top) / rect.height) * H };
  }

  function pickLayer(point: { x: number; y: number }) {
    for (const layer of [...layers].reverse()) {
      const size = layer.fontSize * layer.scale * 1.2;
      if (Math.abs(point.x - layer.x) < size * 2.1 && Math.abs(point.y - layer.y) < size * .9) return layer.id;
    }
    return null;
  }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = canvasPoint(event);
    const id = pickLayer(point);
    setSelected(id);
    if (id) {
      const layer = layers.find((item) => item.id === id);
      if (layer) setDrag({ id, dx: point.x - layer.x, dy: point.y - layer.y });
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag) return;
    const point = canvasPoint(event);
    setLayers((current) => current.map((layer) => layer.id === drag.id ? { ...layer, x: point.x - drag.dx, y: point.y - drag.dy } : layer));
  }

  function pointerUp() {
    if (drag) setHistory((h) => [...h.slice(-29), layers]);
    setDrag(null);
  }

  return (
    <main className="wrap" style={{ maxWidth: 1180, paddingBottom: 30 }} dir="rtl">
      <section className="glass hero" style={{ padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <p className="muted" style={{ margin: 0 }}>GAMEVORTEX STUDIO</p>
            <h1 style={{ margin: "6px 0" }}>استوديو خلفيات GameVortex</h1>
            <p className="muted" style={{ margin: 0 }}>صمّم خلفية شاشة هاتفك مباشرة من المتصفح.</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link href="/wallpapers" className="btn secondary">الخلفيات</Link>
            <button className="btn secondary" onClick={undo} disabled={!history.length}>تراجع</button>
            <button className="btn secondary" onClick={redo} disabled={!future.length}>إعادة</button>
            <button className="btn" onClick={exportImage}>↓ تحميل PNG</button>
          </div>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 380px)", gap: 18, marginTop: 18, alignItems: "start" }}>
        <div className="glass card" style={{ display: "grid", placeItems: "center", padding: 16 }}>
          <div style={{ width: "min(100%, 390px)", position: "relative", borderRadius: 34, padding: 7, background: "#08090c", boxShadow: "0 24px 70px rgba(0,0,0,.5)" }}>
            <canvas ref={canvasRef} width={W} height={H} style={{ display: "block", width: "100%", height: "auto", borderRadius: 28, touchAction: "none", background: "#111" }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} aria-label="Wallpaper editor canvas" />
            {selectedLayer && <div className="badge" style={{ marginTop: 10, textAlign: "center", width: "100%" }}>العنصر المحدد: {selectedLayer.kind === "clock" ? "الساعة" : selectedLayer.kind === "text" ? selectedLayer.text : selectedLayer.kind}</div>}
          </div>
        </div>

        <aside className="glass card" style={{ padding: 14 }}>
          <div className="platform-list" style={{ marginBottom: 12 }}>
            {([ ["background", "الخلفية"], ["tools", "الأدوات"], ["text", "النص"], ["effects", "التأثيرات"] ] as const).map(([key, label]) => <button key={key} className={`platform-chip ${activeTab === key ? "active" : ""}`} onClick={() => setActiveTab(key)}>{label}</button>)}
          </div>

          {activeTab === "background" && <div>
            <button className="btn" style={{ width: "100%", marginBottom: 10 }} onClick={() => fileInputRef.current?.click()}>＋ رفع صورة من الهاتف</button>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleUpload} hidden />
            <p className="muted">خلفيات GameVortex</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 7 }}>
              {library.map((item) => <button key={item.id} onClick={() => setBackground(item.src)} aria-label={`اختيار ${item.title}`} style={{ padding: 0, border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, overflow: "hidden", background: "#111", cursor: "pointer" }}>
                <img src={item.src} alt="" loading="lazy" style={{ display: "block", width: "100%", aspectRatio: "9/14", objectFit: "cover" }} />
                {item.isVip && <span className="badge" style={{ display: "block", borderRadius: 0 }}>VIP</span>}
              </button>)}
            </div>
          </div>}

          {activeTab === "tools" && <div style={{ display: "grid", gap: 10 }}>
            <button className="btn" onClick={() => addPreset("clock", formatDates().clock)}>＋ ساعة</button>
            <button className="btn secondary" onClick={() => addPreset("gregorian", formatDates().gregorian)}>＋ التاريخ الميلادي</button>
            <button className="btn secondary" onClick={() => addPreset("hijri", formatDates().hijri)}>＋ التاريخ الهجري</button>
            <button className="btn secondary" onClick={() => addPreset("overlay", "GameVortex")}>＋ زخرفة GameVortex</button>
            {selectedLayer && <div style={{ borderTop: "1px solid rgba(255,255,255,.1)", paddingTop: 12, display: "grid", gap: 9 }}>
              <label>الحجم <input type="range" min=".35" max="2.5" step=".05" value={selectedLayer.scale} onChange={(e) => updateSelected({ scale: Number(e.target.value) })} /></label>
              <label>الشفافية <input type="range" min=".1" max="1" step=".05" value={selectedLayer.opacity} onChange={(e) => updateSelected({ opacity: Number(e.target.value) })} /></label>
              <label>الدوران <input type="range" min="-180" max="180" value={selectedLayer.rotation} onChange={(e) => updateSelected({ rotation: Number(e.target.value) })} /></label>
              <input type="color" value={selectedLayer.color} onChange={(e) => updateSelected({ color: e.target.value })} aria-label="لون العنصر" />
              <button className="btn secondary" onClick={() => updateSelected({ visible: !selectedLayer.visible })}>{selectedLayer.visible ? "إخفاء" : "إظهار"}</button>
              <button className="btn secondary" onClick={() => { commit(layers.filter((layer) => layer.id !== selected)); setSelected(null); }}>حذف العنصر</button>
            </div>}
          </div>}

          {activeTab === "text" && <div style={{ display: "grid", gap: 10 }}>
            <textarea className="input" value={customText} onChange={(e) => setCustomText(e.target.value)} placeholder="اكتب نصًا عربيًا أو إنجليزيًا..." rows={4} />
            <button className="btn" onClick={addText}>＋ إضافة النص</button>
            {selectedLayer && <div style={{ display: "grid", gap: 8 }}>
              <label>النص المحدد<input className="input" value={selectedLayer.text} onChange={(e) => updateSelected({ text: e.target.value })} /></label>
              <label>حجم الخط<input type="range" min="18" max="220" value={selectedLayer.fontSize} onChange={(e) => updateSelected({ fontSize: Number(e.target.value) })} /></label>
            </div>}
          </div>}

          {activeTab === "effects" && <div style={{ display: "grid", gap: 8 }}>
            {([ ["none", "بدون تأثير"], ["dim", "تعتيم"], ["vignette", "Vignette"], ["grain", "Grain"], ["blue", "Blue Tone"] ] as const).map(([value, label]) => <button key={value} className={`btn ${effect === value ? "" : "secondary"}`} onClick={() => setEffect(value)}>{label}</button>)}
            <p className="muted" style={{ fontSize: 13 }}>كل التأثيرات الأساسية تعمل محليًا داخل المتصفح ولا تحتاج API خارجي.</p>
          </div>}
        </aside>
      </section>

      {previewUrl && <section className="glass card" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div><strong>المعاينة النهائية</strong><p className="muted" style={{ margin: "4px 0 0" }}>تم تجهيز PNG بدقة 1080×1920.</p></div>
          <button className="btn secondary" onClick={() => setPreviewUrl(null)}>إغلاق</button>
        </div>
        <img src={previewUrl} alt="معاينة خلفية GameVortex" style={{ display: "block", width: "min(100%, 360px)", margin: "16px auto 0", borderRadius: 18 }} />
      </section>}

      <style jsx>{`
        @media (max-width: 820px) {
          section[style*="grid-template-columns: minmax(0, 1fr) minmax(280px, 380px)"] { grid-template-columns: 1fr !important; }
        }
        label { display: grid; gap: 5px; font-size: 14px; }
        input[type="range"] { width: 100%; }
      `}</style>
    </main>
  );
}
