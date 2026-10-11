"use client";

import { useState } from "react";
import { adminErrorMessage, NETWORK_ERROR_MESSAGE } from "@/lib/admin-client";

export default function UserRoleSelect({
  userId,
  initialRole,
  disabled,
  canAssignOwnerRole = false,
}: {
  userId: string;
  initialRole: string;
  disabled?: boolean;
  canAssignOwnerRole?: boolean;
}) {
  const [role, setRole] = useState(initialRole);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function change(value: string) {
    if (busy) return;

    const previous = role;

    setRole(value);
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/admin/owner-control", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, role: value }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        // Roll the dropdown back so it never shows a role that was not saved.
        setRole(previous);
        setError(
          adminErrorMessage(
            data?.error,
            response.status === 401
              ? adminErrorMessage("UNAUTHORIZED")
              : response.status === 403
                ? adminErrorMessage("FORBIDDEN")
                : response.status === 429
                  ? adminErrorMessage("RATE_LIMITED")
                  : "تعذر حفظ الدور.",
          ),
        );
      }
    } catch {
      setRole(previous);
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <select
        value={role}
        disabled={disabled || busy}
        aria-busy={busy}
        onChange={(event) => void change(event.target.value)}
      >
        <option value="USER">USER</option>
        <option value="STAFF">STAFF</option>
        {(canAssignOwnerRole || initialRole === "SUPER_ADMIN") && (
          <option value="SUPER_ADMIN">SUPER_ADMIN</option>
        )}
      </select>

      {busy ? <small className="muted">جارٍ الحفظ...</small> : null}

      {error ? (
        <small role="alert" style={{ color: "#ff8fa3", maxWidth: 220 }}>
          {error}
        </small>
      ) : null}
    </span>
  );
}
