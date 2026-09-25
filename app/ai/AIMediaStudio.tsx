"use client";

import { useEffect, useState } from "react";
import styles from "./ai.module.css";

type Job = {
  id: string;
  status: string;
  resultUrl?: string | null;
  provider?: string;
  model?: string | null;
};

export default function AIMediaStudio() {
  const [tab, setTab] = useState<"image" | "video">("image");
  const [prompt, setPrompt] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => {
    if (!job || job.status === "COMPLETED" || job.status === "FAILED") return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/ai/video/status?jobId=${encodeURIComponent(job.id)}`, { cache: "no-store" });
        const data = await response.json();
        if (response.ok && data?.job) setJob(data.job as Job);
      } catch {
        // Polling is best-effort; the job remains on the server.
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [job]);

  async function generate() {
    setError(null);
    setImages([]);
    setJob(null);
    setLoading(true);
    try {
      if (tab === "image") {
        const response = await fetch("/api/ai/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, imageSize: "landscape_4_3", numImages: 1 }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || "IMAGE_GENERATION_FAILED");
        setImages(Array.isArray(data?.images) ? data.images : []);
      } else {
        const response = await fetch("/api/ai/video", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, imageUrl: imageUrl.trim() || undefined, duration: 6, resolution: "768P" }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || "VIDEO_GENERATION_FAILED");
        setJob(data.job as Job);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI_GENERATION_FAILED");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className={styles.mediaStudio} aria-label="GameVortex AI Studio">
      <div className={styles.mediaTabs}>
        <button type="button" className={tab === "image" ? styles.mediaTabActive : styles.mediaTab} onClick={() => setTab("image")}>Image</button>
        <button type="button" className={tab === "video" ? styles.mediaTabActive : styles.mediaTab} onClick={() => setTab("video")}>Video</button>
      </div>

      <div className={styles.mediaStudioGrid}>
        <div>
          <span className={styles.sectionKicker}>AI STUDIO</span>
          <h2>{tab === "image" ? "إنشاء صورة بالذكاء الاصطناعي" : "إنشاء فيديو بالذكاء الاصطناعي"}</h2>
          <p className={styles.mediaHint}>
            {tab === "image" ? "يتم خصم رصيد Image من الخادم بعد التحقق من الحساب والـVIP." : "الفيديو يعمل كمهمة غير متزامنة، ولا يبقى طلب HTTP مفتوحًا حتى انتهاء التوليد."}
          </p>

          <textarea className="input" rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="اكتب وصفك هنا..." maxLength={4000} />
          {tab === "video" && (
            <input className="input" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="رابط صورة البداية (اختياري)" maxLength={4000} />
          )}
          <button className="btn" type="button" onClick={() => void generate()} disabled={loading || !prompt.trim()}>
            {loading ? "جارٍ الإرسال..." : tab === "image" ? "إنشاء الصورة" : "إنشاء الفيديو"}
          </button>
          {error && <p className={styles.mediaError}>{error}</p>}
        </div>

        <div className={styles.mediaResult}>
          {images.map((url) => <img key={url} src={url} alt="AI generated" loading="lazy" />)}
          {job && <div className={styles.mediaJob}><strong>الحالة: {job.status}</strong>{job.resultUrl && <video src={job.resultUrl} controls playsInline />}</div>}
          {!images.length && !job && <div className={styles.mediaEmpty}>ستظهر النتيجة هنا بعد التوليد.</div>}
        </div>
      </div>
    </section>
  );
}
