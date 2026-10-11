"use client";

import { useEffect } from "react";
import Link from "next/link";
import styles from "./admin.module.css";

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
    // Reporting must never throw inside an error boundary.
  }
}

/**
 * Error boundary for the admin area. It keeps the sidebar and menu alive
 * (the generic app/error.tsx replaced the whole screen) and offers a retry
 * plus a way to the dashboard instead of a dead end.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <div className={styles.stateBox} dir="rtl" role="alert">
      <span className="badge">ERROR</span>

      <h1 style={{ fontSize: 20 }}>تعذّر تحميل هذه الصفحة</h1>

      <p className="muted">
        تم تسجيل الخطأ في سجل النظام. يمكنك إعادة المحاولة؛ إعادة المحاولة لا
        تعيد تنفيذ أي عملية مالية.
        {error.digest ? ` (رمز: ${error.digest})` : ""}
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <button type="button" className="btn" onClick={() => reset()}>
          إعادة المحاولة
        </button>

        <Link href="/admin" className="btn secondary">
          لوحة التحكم
        </Link>
      </div>
    </div>
  );
}
