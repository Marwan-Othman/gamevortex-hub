"use client";

import { useState } from "react";

export default function CopyReferralLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="referral-copy">
      <code className="input" style={{ display: "block", overflowWrap: "anywhere" }}>{link}</code>
      <button className="btn" type="button" onClick={copy}>{copied ? "تم النسخ ✓" : "نسخ الرابط"}</button>
    </div>
  );
}
