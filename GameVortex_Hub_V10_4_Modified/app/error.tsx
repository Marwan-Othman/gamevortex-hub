"use client";
import { useEffect } from "react";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("GameVortex application error"); }, []);
  return <main className="wrap" dir="rtl"><section className="glass hero"><span className="badge">ERROR</span><h1>حدث خطأ غير متوقع</h1><p className="muted">تم تسجيل الخطأ محليًا. يمكنك إعادة المحاولة دون إعادة إرسال العملية المالية.</p><button className="btn" onClick={() => reset()}>إعادة المحاولة</button></section></main>;
}
