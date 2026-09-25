"use client";

import { useEffect, useState } from "react";
import styles from "./ai.module.css";

type Status = {
  isOwner?: boolean;
  isVip?: boolean;
  planCode?: string;
  chatCredits?: number;
  imageCredits?: number;
  videoCredits?: number;
} | null;

export default function AICreditsPanel() {
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    fetch("/api/vip/status", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setStatus(data?.data || null))
      .catch(() => setStatus(null));
  }, []);

  if (!status) return null;
  const unlimited = status.isOwner;

  return (
    <section className={styles.creditsPanel} aria-label="AI Credits">
      <div><span>Chat</span><strong>{unlimited ? "∞" : (status.chatCredits ?? 0).toLocaleString("en-US")}</strong></div>
      <div><span>Images</span><strong>{unlimited ? "∞" : (status.imageCredits ?? 0).toLocaleString("en-US")}</strong></div>
      <div><span>Video</span><strong>{unlimited ? "∞" : (status.videoCredits ?? 0).toLocaleString("en-US")}</strong></div>
      <small>{unlimited ? "Owner VIP · Unlimited product usage" : `${status.planCode || "FREE"} · Usage protected server-side`}</small>
    </section>
  );
}
