"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";

const W = 1080;
const H = 1920;

type Item = { id: string; name: string; url: string; file: File };

type Layout = "stack" | "grid" | "hero";

function uid() {
  return crypto.randomUUID();
}

export default function SmartMerge() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [layout, setLayout] = useState<Layout>("hero");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => () => items.forEach((item) => URL.revokeObjectURL(item.url)), [items]);

  function addImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    const accepted = files.slice(0, 6).filter((file) => file.size <= 15 * 1024 * 1024);
    const next = accepted.map((file) => ({ id: uid(), name: file.name, url: URL.createObjectURL(file), file }));
    setItems((current) => [...current, ...next].slice(0, 6));
    setStatus(`${next.length} صورة أضيفت إلى الدمج.`);
    event.target.value = "";
  }

  function remove(id: string) {
    setItems((current) => {
      const found = current.find((item) => item.id === id);
      if (found) URL.revokeObjectURL(found.url);
      return current.filter((item) => item.id !== id);
    });
  }

  async function merge() {
    if (!items.length) {
      setStatus("أضف صورتين على الأقل أولًا.");
      return;
    }
    setBusy(true);
    setStatus("جاري تركيب الصور وتجهيز Wallpaper بدقة 1080×1920...");
    try {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) throw new Error("CANVAS");
      ctx.clearRect(0, 0, W, H);
      const gradient = ctx.createLinearGradient(0, 0, 0, H);
      gradient.addColorStop(0, "#080b14");
      gradient.addColorStop(1, "#020308");
      ctx.fillStyle = gradient;
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
        if (loaded.length > 1) {
          const smallW = 300;
          const smallH = 420;
          loaded.slice(1, 4).forEach((image, index) => {
            const x = 55 + index * 340;
            const y = H - 500;
            ctx.save();
            ctx.shadowColor = "rgba(0,0,0,.55)";
            ctx.shadowBlur = 28;
            drawCover(image, x, y, smallW, smallH, 32);
            ctx.restore();
          });
        }
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

      const shade = ctx.createLinearGradient(0, 0, 0, H);
      shade.addColorStop(0, "rgba(0,0,0,.05)");
      shade.addColorStop(.65, "rgba(0,0,0,.08)");
      shade.addColorStop(1, "rgba(0,0,0,.38)");
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, W, H);
      setStatus("تم دمج الصور. يمكنك تنزيل النتيجة ثم فتحها في Wallpaper Studio لإضافة الساعة والاسم والتأثيرات.");
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
        <h1 style={{ margin: "6px 0" }}>ادمج صورك في Wallpaper واحد</h1>
        <p className="muted" style={{ margin: 0 }}>أضف عدة صور، اختر طريقة التركيب، ثم استخدم الناتج داخل Wallpaper Studio.</p>
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
          <p className="muted" style={{ fontSize: 13 }}>حتى 6 صور، بحد أقصى 15MB للصورة.</p>

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
              <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, borderRadius: 12, background: "rgba(255,255,255,.05)" }}>
                <img src={item.url} alt="" width={48} height={64} style={{ objectFit: "cover", borderRadius: 8 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{index + 1}. {item.name}</span>
                <button className="btn secondary" onClick={() => remove(item.id)} aria-label={`حذف ${item.name}`}>حذف</button>
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
