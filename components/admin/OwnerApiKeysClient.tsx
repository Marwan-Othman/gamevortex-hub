"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/ui/useLocale";

type ApiKey = {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  user: { email: string; username: string | null };
  _count: { requests: number };
};

export default function OwnerApiKeysClient() {
  const english = useLocale() === "en";
  const t = (ar: string, en: string) => english ? en : ar;
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/admin/api-keys", { cache: "no-store" });
    if (!response.ok) throw new Error("LOAD_FAILED");
    const result = await response.json();
    setKeys(Array.isArray(result.data) ? result.data : []);
  }

  useEffect(() => { void load().catch(() => setError(t("تعذر تحميل المفاتيح", "Could not load API keys"))); }, []);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNewKey("");
    try {
      const response = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, label }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "CREATE_FAILED");
      setNewKey(result.data.key);
      setEmail("");
      setLabel("");
      await load();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "CREATE_FAILED";
      setError(code === "USER_NOT_FOUND" ? t("لا يوجد حساب بهذا البريد", "No account found for this email") : t("تعذر إصدار المفتاح", "Could not create API key"));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError("");
    try {
      const response = await fetch(`/api/admin/api-keys/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "revoke" }) });
      if (!response.ok) throw new Error("REVOKE_FAILED");
      await load();
    } catch {
      setError(t("تعذر إلغاء المفتاح", "Could not revoke API key"));
    }
  }

  return <section style={{ display: "grid", gap: 20 }}>
    <form onSubmit={create} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, alignItems: "end" }}>
      <label>{t("بريد المستخدم", "User email")}<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>{t("اسم المفتاح", "Key label")}<input required maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <button type="submit" disabled={busy}>{busy ? t("جارٍ الإصدار...", "Creating...") : t("إصدار مفتاح", "Create key")}</button>
    </form>
    {newKey && <div role="status"><strong>{t("انسخ المفتاح الآن؛ لن يظهر مرة أخرى", "Copy this key now; it will not be shown again")}</strong><code dir="ltr" style={{ display: "block", overflowWrap: "anywhere" }}>{newKey}</code><button type="button" onClick={() => void navigator.clipboard.writeText(newKey)}>{t("نسخ المفتاح", "Copy key")}</button></div>}
    {error && <p role="alert">{error}</p>}
    <div style={{ overflowX: "auto" }}><table><thead><tr><th>{t("المستخدم", "User")}</th><th>{t("المفتاح", "Key")}</th><th>{t("الطلبات", "Requests")}</th><th>{t("آخر استخدام", "Last used")}</th><th>{t("الحالة", "Status")}</th><th /></tr></thead><tbody>
      {keys.map((key) => <tr key={key.id}><td>{key.user.username || key.user.email}</td><td dir="ltr">{key.prefix}… <small>{key.label}</small></td><td>{key._count.requests}</td><td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : t("لم يُستخدم", "Never")}</td><td>{key.revokedAt ? t("ملغى", "Revoked") : t("نشط", "Active")}</td><td>{!key.revokedAt && <button type="button" onClick={() => void revoke(key.id)}>{t("إلغاء", "Revoke")}</button>}</td></tr>)}
    </tbody></table></div>
  </section>;
}