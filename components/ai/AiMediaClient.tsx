"use client";

import { useEffect, useRef, useState } from "react";
import { aiErrorMessage, formatBalance, loadAiUsage, readApiError, type AiUsageSummary } from "@/components/ai/ai-errors";

type Mode = "video";

const MAX_IMAGE_BYTES = 2.8 * 1024 * 1024; // base64 + data-URL prefix must stay under the API's 4,000,000 character limit
const MAX_IMAGE_DATA_CHARS = 4_000_000;
const IMAGE_CLIENT_TIMEOUT_MS = 150_000;
const POLL_INTERVAL_MS = 3_000;
const POLL_ATTEMPTS = 120;
const MAX_CONSECUTIVE_POLL_ERRORS = 5;
const PENDING_VIDEO_KEY = "gv-ai-pending-video";

function readPendingVideo(): string {
  try { return window.localStorage.getItem(PENDING_VIDEO_KEY) || ""; } catch { return ""; }
}
function writePendingVideo(token: string) {
  try { if (token) window.localStorage.setItem(PENDING_VIDEO_KEY, token); else window.localStorage.removeItem(PENDING_VIDEO_KEY); } catch { /* storage unavailable */ }
}

export default function AiMediaClient() {
  const mode: Mode = "video";
  const [prompt, setPrompt] = useState("");
  const [imageData, setImageData] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [pendingToken, setPendingToken] = useState("");
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  const objectUrlRef = useRef("");
  const mountedRef = useRef(true);

  async function refreshUsage() {
    const next = await loadAiUsage();
    if (mountedRef.current) setUsage(next);
  }

  useEffect(() => {
    mountedRef.current = true;
    void refreshUsage();
    // A video that was started before a reload / tab close can still be collected.
    const saved = readPendingVideo();
    if (saved) {
      setMode("video");
      setPendingToken(saved);
      setStatus("لديك فيديو قيد المعالجة. اضغط «متابعة الانتظار» لاستكماله دون خصم جديد.");
    }
    return () => {
      mountedRef.current = false;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function chooseImage(file: File | undefined) {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setStatus("الصورة يجب أن تكون PNG أو JPEG أو WebP.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setStatus("حجم صورة الإدخال يجب ألا يتجاوز 2.8MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result || result.length > MAX_IMAGE_DATA_CHARS) { setStatus("تعذر استخدام هذه الصورة. جرّب صورة أصغر."); return; }
      setImageData(result);
      setStatus("");
    };
    reader.onerror = () => setStatus("تعذر قراءة الصورة.");
    reader.readAsDataURL(file);
  }

  /** Polls one video token until it completes, fails, or the wait budget runs out. */
  async function pollVideo(token: string) {
    let errors = 0;
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      if (!mountedRef.current) return;
      let poll: Response;
      try {
        poll = await fetch("/api/ai/video/status?token=" + encodeURIComponent(token), { cache: "no-store" });
      } catch {
        if (++errors >= MAX_CONSECUTIVE_POLL_ERRORS) throw new Error("AI_SERVICE_UNAVAILABLE");
        continue;
      }
      // Rate limited or a transient server error: keep waiting, the video is still being made.
      if (poll.status === 429 || poll.status >= 500) {
        if (++errors >= MAX_CONSECUTIVE_POLL_ERRORS * 2) throw new Error("AI_SERVICE_UNAVAILABLE");
        continue;
      }
      errors = 0;
      if (!poll.ok) {
        writePendingVideo("");
        setPendingToken("");
        throw new Error(await readApiError(poll));
      }
      const pollJson = await poll.json().catch(() => null);
      const state = pollJson?.data?.status;
      if (state === "completed" && typeof pollJson.data.videoUrl === "string" && pollJson.data.videoUrl.startsWith("/api/ai/video/file?")) {
        writePendingVideo("");
        setPendingToken("");
        setVideoUrl(pollJson.data.videoUrl);
        setStatus("اكتمل الفيديو.");
        return;
      }
      if (state === "failed") {
        writePendingVideo("");
        setPendingToken("");
        throw new Error(pollJson.data.refunded === true || usage?.unlimited ? "VIDEO_GENERATION_FAILED" : "VIDEO_GENERATION_FAILED_REFUND_PENDING");
      }
      setStatus("الفيديو قيد المعالجة... (" + Math.min(100, Math.round(((attempt + 1) / POLL_ATTEMPTS) * 100)) + "%)");
    }
    // Keep the token: the same request can be resumed without paying again.
    setPendingToken(token);
    throw new Error("VIDEO_GENERATION_TIMEOUT");
  }

  async function generate() {
    const text = prompt.trim();
    if (!text || busy) return;

    setBusy(true);
    setStatus("جاري بدء إنشاء الفيديو...");
    setVideoUrl("");

    try {
      const response = await fetch("/api/ai/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: text,
            imageData: imageData || undefined,
            aspectRatio: "16:9",
            resolution: "720p",
            idempotencyKey: crypto.randomUUID(),
          }),
        });
        if (!response.ok) throw new Error(await readApiError(response));
        const json = await response.json().catch(() => null);
        const token = typeof json?.data?.token === "string" ? json.data.token : "";
        if (!token) throw new Error("AI_EMPTY_RESPONSE");

        writePendingVideo(token);
        setPendingToken(token);
        setStatus("تم بدء إنشاء الفيديو. انتظر حتى يكتمل...");
        await pollVideo(token);
    } catch (error) {
      if (mountedRef.current) setStatus(aiErrorMessage(error instanceof Error ? error.message : ""));
    } finally {
      if (mountedRef.current) setBusy(false);
      void refreshUsage();
    }
  }

  async function resumeVideo() {
    if (!pendingToken || busy) return;
    setBusy(true);
    setVideoUrl("");
    setStatus("جاري متابعة الفيديو...");
    try {
      await pollVideo(pendingToken);
    } catch (error) {
      if (mountedRef.current) setStatus(aiErrorMessage(error instanceof Error ? error.message : ""));
    } finally {
      if (mountedRef.current) setBusy(false);
      void refreshUsage();
    }
  }

  return (
    <main dir="auto" style={{ minHeight: "100dvh", padding: 24, color: "var(--foreground, #fff)" }}>
      <div style={{ maxWidth: 1050, margin: "0 auto" }}>
        <div style={{ marginBottom: 22 }}>
          <div style={{ opacity: .6, fontSize: 13 }}>GameVortex AI</div>
          <h1 style={{ fontSize: 38, margin: "6px 0" }}>إنشاء الفيديو</h1>
          <p style={{ opacity: .7, margin: 0 }}>إنشاء الفيديو مع حماية المفاتيح والرصيد من جهة الخادم. {formatBalance(usage)}</p>
        </div>

        <section style={{ background: "#111113", border: "1px solid #27272a", borderRadius: 20, padding: 18 }}>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)} disabled={busy}
            placeholder="صف الفيديو والحركة والمشهد والكاميرا..."
            style={{ width: "100%", minHeight: 130, borderRadius: 14, border: "1px solid #3f3f46", background: "#09090b", color: "#fff", padding: 14, resize: "vertical" }} />

          <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ border: "1px solid #3f3f46", borderRadius: 10, padding: "9px 12px", cursor: "pointer" }}>
              {imageData ? "تم اختيار صورة مرجعية" : "اختياري: صورة إلى فيديو"}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => void chooseImage(e.target.files?.[0])} />
            </label>
            <button type="button" onClick={() => void generate()} disabled={busy || !prompt.trim()}
              style={{ border: 0, borderRadius: 10, padding: "10px 18px", cursor: "pointer" }}>
              {busy ? "جاري التنفيذ..." : "إنشاء الفيديو"}
            </button>
            {pendingToken && !busy && <button type="button" onClick={() => void resumeVideo()} style={{ border: "1px solid #3f3f46", borderRadius: 10, padding: "9px 14px", cursor: "pointer", background: "transparent", color: "#fff" }}>متابعة الانتظار</button>}
            {imageData && <button type="button" onClick={() => setImageData("")} disabled={busy} style={{ border: 0, background: "transparent", color: "#aaa", cursor: "pointer" }}>إزالة الصورة المرجعية</button>}
          </div>

          {status && <div role="status" style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "#18181b", color: "#d4d4d8" }}>{status}</div>}

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
