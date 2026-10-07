import { createHmac, timingSafeEqual } from "node:crypto";

type MediaTokenPayload = {
  sub: string;
  interactionId: string;
  fileUri?: string;
  kind: "IMAGE" | "VIDEO";
  creditKey: string;
  creditAmount: number;
  exp: number;
};

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET_NOT_CONFIGURED");
  return value;
}

function encode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createMediaToken(input: Omit<MediaTokenPayload, "exp"> & { ttlSeconds?: number }) {
  const payload = encode(JSON.stringify({
    sub: input.sub,
    interactionId: input.interactionId,
    fileUri: input.fileUri,
    kind: input.kind,
    creditKey: input.creditKey,
    creditAmount: input.creditAmount,
    exp: Math.floor(Date.now() / 1000) + (input.ttlSeconds ?? 60 * 60),
  }));
  return payload + "." + sign(payload);
}

export function readMediaToken(token: string): MediaTokenPayload | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(decode(payload)) as Partial<MediaTokenPayload>;
    if (
      typeof data.sub !== "string" ||
      typeof data.interactionId !== "string" ||
      (data.kind !== "IMAGE" && data.kind !== "VIDEO") ||
      typeof data.creditKey !== "string" || !data.creditKey ||
      typeof data.creditAmount !== "number" || !Number.isSafeInteger(data.creditAmount) || data.creditAmount <= 0 ||
      typeof data.exp !== "number" ||
      data.exp <= Math.floor(Date.now() / 1000)
    ) return null;
    if (data.fileUri !== undefined && typeof data.fileUri !== "string") return null;
    return data as MediaTokenPayload;
  } catch {
    return null;
  }
}
