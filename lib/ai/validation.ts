// Pure request validation helpers shared by the AI routes and lib/ai/media.ts (no framework imports).

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

/** Client-supplied idempotency keys are stored in unique columns, so bound their size and alphabet. */
export function readIdempotencyKey(value: unknown, fallback: string): string | null {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return null;
  const key = value.trim();
  return KEY_PATTERN.test(key) ? key : null;
}

const IMAGE_DATA_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
export const MAX_IMAGE_DATA_CHARS = 4_000_000;

export function parseImageData(imageData: string): { mimeType: string; data: string } {
  if (imageData.length > MAX_IMAGE_DATA_CHARS) throw new Error("INVALID_IMAGE_INPUT");
  const match = IMAGE_DATA_PATTERN.exec(imageData);
  if (!match || match[2].length < 16) throw new Error("INVALID_IMAGE_INPUT");
  return { mimeType: match[1], data: match[2] };
}

const IMAGE_SIZES = new Set(["1K", "2K", "4K"]);
const ASPECT_RATIOS = new Set(["1:1", "16:9", "9:16", "4:3", "3:4"]);
const VIDEO_ASPECT_RATIOS = new Set(["16:9", "9:16"]);
const VIDEO_RESOLUTIONS = new Set(["720p"]);

/** Returns the value when allowed, undefined when absent, null when present but not allowed. */
function pick(value: unknown, allowed: Set<string>): string | undefined | null {
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "string" && allowed.has(value) ? value : null;
}

export const pickImageSize = (value: unknown) => pick(value, IMAGE_SIZES);
export const pickAspectRatio = (value: unknown) => pick(value, ASPECT_RATIOS);
export const pickVideoAspectRatio = (value: unknown) => pick(value, VIDEO_ASPECT_RATIOS);
export const pickVideoResolution = (value: unknown) => pick(value, VIDEO_RESOLUTIONS);
