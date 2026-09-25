"use client";

import { useState } from "react";
import styles from "../../app/auth/auth.module.css";

const PROVIDERS = [
  {
    id: "google",
    label: "Google",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24">
        <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.2s2.7-6.2 6-6.2c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.9 3.3 14.7 2.3 12 2.3 6.9 2.3 2.7 6.5 2.7 12S6.9 21.7 12 21.7c6.9 0 9.3-4.8 9.3-7.3 0-.5-.05-.9-.13-1.3H12z" />
      </svg>
    ),
  },
  {
    id: "playstation",
    label: "PlayStation",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8.98 1.5v18.16l3.15 1.02V4.9c0-.71.31-1.19.82-1.02.66.19.79.85.79 1.56v6.86c1.98.97 3.54.09 3.54-2.4 0-2.56-.9-3.7-3.5-4.63A38.6 38.6 0 0 0 8.98 1.5zM20.5 16.6c-1.02.55-2.5.72-4.3.15v2.24c2.44.9 4.6.55 5.8-.5.5-.45.72-1.08.5-1.7-.16-.5-.6-.85-2-.19zm-16.3.24c-1.15.42-1.3 1.08-.44 1.52 1.09.55 3.86 1 5.85.05v-2.16c-1.85.7-3.95.94-5.4.6z" />
      </svg>
    ),
  },
  {
    id: "xbox",
    label: "Xbox",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="12" r="9.5" />
        <path d="M6 6c2 2.5 3.6 4.4 6 4.4S16 8.5 18 6M6 18c2-2.5 3.6-4.4 6-4.4S16 15.5 18 18" />
      </svg>
    ),
  },
  {
    id: "steam",
    label: "Steam",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2a10 10 0 0 0-9.95 9.06l5.36 2.22a2.8 2.8 0 0 1 1.6-.5l2.38-3.45v-.05a3.7 3.7 0 1 1 3.7 3.7h-.08l-3.4 2.43a2.8 2.8 0 0 1-5.55.63L2.2 14.4A10 10 0 1 0 12 2zM7.9 17.7a2.1 2.1 0 0 0 4.1-.75l-1.8-.75a2.1 2.1 0 0 0-2.3 1.5zm7.7-6a2.47 2.47 0 1 0 0-4.94 2.47 2.47 0 0 0 0 4.94z" />
      </svg>
    ),
  },
];

/**
 * Visual parity with the reference design (01-login.png). No OAuth
 * provider is actually wired up on the backend, so clicking a button
 * is honest about that instead of pretending to sign the person in.
 */
export default function SocialLoginRow() {
  const [notice, setNotice] = useState<string | null>(null);

  function handleClick(label: string) {
    setNotice(`تسجيل الدخول عبر ${label} غير مفعّل بعد`);
    window.setTimeout(() => setNotice(null), 2200);
  }

  return (
    <>
      <div className={styles.divider}>أو التسجيل باستخدام</div>
      <div className={styles.socialRow}>
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={styles.socialBtn}
            aria-label={p.label}
            onClick={() => handleClick(p.label)}
          >
            {p.icon}
          </button>
        ))}
      </div>
      {notice && <div className={styles.toast} role="status">{notice}</div>}
    </>
  );
}
