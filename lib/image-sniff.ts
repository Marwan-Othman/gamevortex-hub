/**
 * فحص نوع الصورة من البايتات الأولى (وليس من الامتداد أو من type الذي يرسله المتصفح).
 * يعمل في المتصفح والخادم. يقبل فقط الصيغ التي يدعمها الاستوديو.
 */
export type SniffedImageType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  if (bytes.length < 12) return null;
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}
