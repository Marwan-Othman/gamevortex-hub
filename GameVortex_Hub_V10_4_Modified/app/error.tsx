"use client";
import { useEffect } from "react";

function reportClientError(error: Error & { digest?: string }) {
  try {
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message.slice(0, 500),
        digest: error.digest,
        path: typeof window !== "undefined" ? window.location.pathname : undefined,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting must never itself throw inside an error boundary.
  }
}

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("GameVortex application error");
    reportClientError(error);
  }, [error]);
  return <main className="wrap" dir="rtl"><section className="glass hero"><span className="badge">ERROR</span><h1>حدث خطأ غير متوقع</h1><p className="muted">تم تسجيل الخطأ. يمكنك إعادة المحاولة دون إعادة إرسال العملية المالية.</p><button className="btn" onClick={() => reset()}>إعادة المحاولة</button></section></main>;
}
