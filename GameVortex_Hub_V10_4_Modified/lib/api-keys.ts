import { randomBytes, createHash } from "node:crypto";
import { db } from "./prisma";

/*
 * GameVortex own API — Master Task Plan Section 3, items 1-3.
 *
 * Keys are never stored in plaintext. Only a SHA-256 hash is kept,
 * same practice as password hashing — even a database leak can't be
 * used to impersonate a buyer's API key.
 */

const KEY_PREFIX = "gvx_live_";

function hashKey(plainKey: string): string {
  return createHash("sha256")
    .update(plainKey)
    .digest("hex");
}

export function generateApiKey(): {
  plainKey: string;
  keyHash: string;
  keyPrefix: string;
} {
  const secret = randomBytes(24).toString("hex");
  const plainKey = `${KEY_PREFIX}${secret}`;

  return {
    plainKey,
    keyHash: hashKey(plainKey),
    // Shown in the owner/user dashboards so a key can be
    // recognized without ever displaying the full secret again.
    keyPrefix: plainKey.slice(0, KEY_PREFIX.length + 6),
  };
}

export type ApiKeyValidationResult =
  | { valid: true; apiKeyId: string; userId: string }
  | { valid: false; reason: "MISSING" | "INVALID" | "REVOKED" };

/*
 * Validates an incoming request's API key (header: x-api-key) and
 * records usage. Intended for GameVortex's own external-facing API
 * endpoints (item 1) — the API a buyer pays for in item 2.
 */
export async function requireApiKey(
  req: Request,
): Promise<ApiKeyValidationResult> {
  const plainKey = req.headers.get("x-api-key");

  if (!plainKey || !plainKey.startsWith(KEY_PREFIX)) {
    return { valid: false, reason: "MISSING" };
  }

  const keyHash = hashKey(plainKey);

  const apiKey = await db.apiKey.findUnique({
    where: { keyHash },
    select: { id: true, userId: true, status: true },
  });

  if (!apiKey) {
    return { valid: false, reason: "INVALID" };
  }

  if (apiKey.status !== "ACTIVE") {
    return { valid: false, reason: "REVOKED" };
  }

  // Fire-and-forget usage tracking — never blocks the actual
  // API response, and never fails the request if it errors.
  db.apiKey
    .update({
      where: { id: apiKey.id },
      data: {
        requestCount: { increment: 1 },
        lastUsedAt: new Date(),
      },
    })
    .catch(() => {});

  return {
    valid: true,
    apiKeyId: apiKey.id,
    userId: apiKey.userId,
  };
}
