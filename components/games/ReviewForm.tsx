"use client";

import { FormEvent, useEffect, useState } from "react";

type Review = { id: string; rating: number; text: string | null };

export default function ReviewForm({ slug }: { slug: string }) {
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [hasReview, setHasReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/games/${encodeURIComponent(slug)}/reviews`, { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return null;
        if (!response.ok) throw new Error("تعذر تحميل مراجعتك.");
        return (await response.json()) as Review | null;
      })
      .then((review) => {
        if (!active) return;
        if (review) {
          setRating(review.rating);
          setText(review.text || "");
          setHasReview(true);
        }
      })
      .catch(() => active && setMessage("سجّل الدخول لكتابة مراجعة."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [slug]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/games/${encodeURIComponent(slug)}/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rating, text: text.trim() || null }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error("سجّل الدخول أولًا لكتابة مراجعة.");
      if (!response.ok) throw new Error(data.error || "تعذر حفظ المراجعة.");
      setHasReview(true);
      setMessage("تم حفظ مراجعتك وتحديث تقييم اللعبة.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "حدث خطأ غير متوقع.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <section className="glass card" aria-busy="true"><span className="muted">جاري تحميل نموذج المراجعة…</span></section>;

  return (
    <section className="glass card review-form" aria-labelledby="review-title">
      <div className="section-head"><div><h2 id="review-title">⭐ {hasReview ? "تعديل مراجعتك" : "قيّم اللعبة"}</h2><p className="muted">يمكن لكل حساب امتلاك مراجعة واحدة، ويمكن تعديلها لاحقًا.</p></div></div>
      <form onSubmit={submit}>
        <label>
          التقييم
          <select className="input" value={rating} onChange={(event) => setRating(Number(event.target.value))} disabled={saving}>
            <option value={5}>★★★★★ — ممتازة</option>
            <option value={4}>★★★★☆ — جيدة جدًا</option>
            <option value={3}>★★★☆☆ — جيدة</option>
            <option value={2}>★★☆☆☆ — ضعيفة</option>
            <option value={1}>★☆☆☆☆ — سيئة</option>
          </select>
        </label>
        <label>
          تعليقك (اختياري)
          <textarea className="input review-textarea" value={text} maxLength={2000} onChange={(event) => setText(event.target.value)} placeholder="ما رأيك في اللعبة؟" disabled={saving} rows={5} />
        </label>
        <div className="review-footer"><span className="muted">{text.length}/2000</span><button className="btn" type="submit" disabled={saving}>{saving ? "جاري الحفظ…" : hasReview ? "حفظ التعديل" : "نشر المراجعة"}</button></div>
      </form>
      {message && <p className="action-message" role="status">{message}</p>}
    </section>
  );
}
