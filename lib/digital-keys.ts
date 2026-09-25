import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function encryptionKey() {
  const secret = process.env.DIGITAL_KEY_ENCRYPTION_SECRET;
  if (!secret || secret.length < 32) throw new Error("DIGITAL_KEY_ENCRYPTION_SECRET_NOT_CONFIGURED");
  return createHash("sha256").update(secret).digest();
}

export function keyFingerprint(code: string) {
  return createHmac("sha256", encryptionKey()).update(code.trim()).digest("hex");
}

export function encryptDigitalKey(code: string) {
  const normalized = code.trim();
  if (!normalized) throw new Error("DIGITAL_KEY_EMPTY");

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptDigitalKey(payload: string) {
  const data = Buffer.from(payload, "base64url");
  if (data.length < 29) throw new Error("DIGITAL_KEY_CIPHERTEXT_INVALID");

  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
