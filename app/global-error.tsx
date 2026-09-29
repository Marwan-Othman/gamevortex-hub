"use client";
import { useEffect } from "react";

// app/error.tsx only catches errors thrown by pages/segments — it cannot
// catch an error thrown by the root layout itself. Next.js requires this
// separate global-error.tsx (which must render its own <html>/<body>) to
// cover that remaining gap, completing the error-boundary coverage for
// item 33 (Monitoring / Error Handling).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("GameVortex root layout error");
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
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      <body className="gv-state-page">
        <div className="gv-state-card">
          <div className="gv-state-icon" aria-hidden="true">⚠</div>
          <h1>حدث خطأ غير متوقع في الموقع</h1>
          <p>تم تسجيل الخطأ. برجاء إعادة تحميل الصفحة.</p>
          <button className="btn" onClick={() => reset()}>إعادة المحاولة</button>
        </div>
      </body>
    </html>
  );
}
