"use client";

import { useEffect, useRef, useState } from "react";

type Mode = "image" | "video";

export default function AiMediaClient() {
  const [mode, setMode] = useState<Mode>("image");
  const [prompt, setPrompt] = useState("");
  const [imageData, setImageData] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const objectUrlRef = useRef("");

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  async function chooseImage(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setStatus("الصورة يجب أن تكون PNG أو JPEG أو WebP.");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setStatus("حجم صورة الإدخال يجب ألا يتجاوز 3MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImageData(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  }

  async function generate() {
    const text = prompt.trim();
    if (!text || busy) return;

    setBusy(true);
    setStatus(mode === "image" ? "جاري إنشاء الصورة..." : "تم بدء إنشاء الفيديو. انتظر حتى يكتمل...");
    setImageUrl("");
    setVideoUrl("");

    try {
      if (mode === "image") {
        const response = await fetch("/api/ai/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: text,
            imageData: imageData || undefined,
            aspectRatio: "16:9",
            imageSize: "1K",
            idempotencyKey: crypto.randomUUID(),
          }),
        });
        if (!response.ok) {
          const json = await response.json().catch(() => null);
          throw new Error(json?.error || "AI_SERVICE_UNAVAILABLE");
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = url;
        setImageUrl(url);
        setStatus("اكتملت الصورة.");
      } else {
        const response = await fetch("/api/ai/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: text,
            imageData: imageData || undefined,
            aspectRatio: "16:9",
            resolution: "720p",
          }),
        });
        const json = await response.json().catch(() => null);
        if (!response.ok || !json?.data?.token) throw new Error(json?.error || "AI_SERVICE_UNAVAILABLE");

        const token = json.data.token;
        for (let attempt = 0; attempt < 120; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, 3000));
          const poll = await fetch("/api/ai/video/status?token=" + encodeURIComponent(token), { cache: "no-store" });
          const pollJson = await poll.json().catch(() => null);
          if (!poll.ok) throw new Error(pollJson?.error || "AI_SERVICE_UNAVAILABLE");
          if (pollJson?.data?.status === "completed" && typeof pollJson.data.videoUrl === "string") {
            setVideoUrl(pollJson.data.videoUrl);
            setStatus("اكتمل الفيديو.");
            break;
          }
          if (pollJson?.data?.status === "failed") throw new Error("VIDEO_GENERATION_FAILED");
          setStatus("الفيديو قيد المعالجة...");
          if (attempt === 119) throw new Error("VIDEO_GENERATION_TIMEOUT");
        }
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const messages: Record<string, string> = {
        AI_VIP_REQUIRED: "توليد الصور والفيديو متاح لمشتركي VIP.",
        AI_CREDITS_EXHAUSTED: "رصيد GVC غير كافٍ لهذه العملية.",
        INVALID_REQUEST: "الطلب غير صالح.",
        VIDEO_GENERATION_FAILED: "فشل إنشاء الفيديو وتمت معالجة الرصيد بأمان.",
        VIDEO_GENERATION_TIMEOUT: "الفيديو ما زال يحتاج وقتًا أطول. أعد المحاولة لاحقًا.",
      };
      setStatus(messages[code] || "تعذر تنفيذ العملية حاليًا.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="auto" style={{ minHeight: "100vh", padding: 24, color: "var(--foreground, #fff)" }}>
      <div style={{ maxWidth: 1050, margin: "0 auto" }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ opacity: .6, fontSize: 13 }}>GameVortex AI</div>
          <h1 style={{ fontSize: 38, margin: "6px 0" }}>إنشاء الصور والفيديو</h1>
          <p style={{ opacity: .7, margin: 0 }}>توليد حقيقي عبر Gemini مع حماية المفاتيح والرصيد من جهة الخادم.</p>
        </div>

        <section style={{ background: "#111113", border: "1px solid #27272a", borderRadius: 20, padding: 18 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            {(["image", "video"] as Mode[]).map(item => (
              <button key={item} type="button" onClick={() => setMode(item)} disabled={busy}
                style={{ border: "1px solid #3f3f46", borderRadius: 10, padding: "9px 14px", cursor: "pointer", background: mode === item ? "#27272a" : "transparent", color: "#fff" }}>
                {item === "image" ? "صورة" : "فيديو"}
              </button>
            ))}
          </div>

          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} disabled={busy}
            placeholder={mode === "image" ? "صف الصورة التي تريد إنشاءها..." : "صف الفيديو والحركة والمشهد والكاميرا..."}
            style={{ width: "100%", minHeight: 130, borderRadius: 14, border: "1px solid #3f3f46", background: "#09090b", color: "#fff", padding: 14, resize: "vertical" }} />

          <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ border: "1px solid #3f3f46", borderRadius: 10, padding: "9px 12px", cursor: "pointer" }}>
              {imageData ? "تم اختيار صورة مرجعية" : mode === "image" ? "اختياري: تعديل صورة" : "اختياري: صورة إلى فيديو"}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => void chooseImage(e.target.files?.[0])} />
            </label>
            <button type="button" onClick={() => void generate()} disabled={busy || !prompt.trim()}
              style={{ border: 0, borderRadius: 10, padding: "10px 18px", cursor: "pointer" }}>
              {busy ? "جاري التنفيذ..." : mode === "image" ? "إنشاء الصورة" : "إنشاء الفيديو"}
            </button>
            {imageData && <button type="button" onClick={() => setImageData("")} disabled={busy} style={{ border: 0, background: "transparent", color: "#aaa", cursor: "pointer" }}>إزالة الصورة المرجعية</button>}
          </div>

          {status && <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "#18181b", color: "#d4d4d8" }}>{status}</div>}

          {imageUrl && (
            <div style={{ marginTop: 18 }}>
              <img src={imageUrl} alt="Generated by GameVortex AI" style={{ width: "100%", borderRadius: 16, display: "block" }} />
            </div>
          )}

          {videoUrl && (
            <div style={{ marginTop: 18 }}>
              <video src={videoUrl} controls playsInline preload="metadata" style={{ width: "100%", borderRadius: 16, display: "block" }} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
