import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const API_KEY_PREFIX = "gvh_live_";
const API_KEY_PATTERN = /^gvh_live_[A-Za-z0-9_-]{43}$/;

export function createApiKey() {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    key,
    prefix: key.slice(0, API_KEY_PREFIX.length + 8),
    secretHash: hashApiKey(key),
  };
}

export function hashApiKey(key: string) {
  if (!API_KEY_PATTERN.test(key)) throw new Error("INVALID_API_KEY");
  return createHash("sha256").update(key).digest("hex");
}

export function matchesApiKey(key: string, expectedHash: string) {
  if (!API_KEY_PATTERN.test(key) || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(hashApiKey(key), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return timingSafeEqual(actual, expected);
}