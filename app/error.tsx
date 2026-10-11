"use client";
import { useEffect } from "react";
import Link from "next/link";

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
    // Next.js strips the real message from server-component errors in production; the digest is the key
    // that matches this crash to the full stack trace in the server logs.
    console.error("GameVortex application error", error.digest ?? "");
    reportClientError(error);
  }, [error]);
  return <main className="wrap" dir="rtl"><section className="glass hero"><span className="badge">ERROR</span><h1>حدث خطأ غير متوقع</h1><p className="muted">تم تسجيل الخطأ. يمكنك إعادة المحاولة دون إعادة إرسال العملية المالية.{error.digest ? ` (رمز المرجع: ${error.digest})` : ""}</p><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button className="btn" type="button" onClick={() => reset()}>إعادة المحاولة</button><Link className="btn secondary" href="/">الصفحة الرئيسية</Link></div></section></main>;
}
