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
      <body style={{ background: "#06070d", color: "#f5f5fa", fontFamily: "system-ui, sans-serif", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 24, marginBottom: 12 }}>حدث خطأ غير متوقع في الموقع</h1>
          <p style={{ opacity: 0.7, marginBottom: 20 }}>تم تسجيل الخطأ. برجاء إعادة تحميل الصفحة.</p>
          <button
            onClick={() => reset()}
            style={{ padding: "10px 22px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", color: "#fff", cursor: "pointer" }}
          >
            إعادة المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}
