/**
 * تخزين محلي للاستوديو (في متصفح المستخدم فقط):
 *  - الصور الخاصة المرفوعة من الهاتف تُحفظ في IndexedDB فلا تضيع بعد تحديث الصفحة،
 *    ولا تُرفع للخادم ولا تظهر في المكتبة العامة.
 *  - تصاميم الزائر غير المسجل تُحفظ في localStorage.
 */
import { sniffImageType } from "@/lib/image-sniff";
import {
  studioDocumentSchema,
  type StudioBackground,
  type StudioDocument,
  type StudioLayer,
  type StudioTemplateId,
} from "@/lib/wallpaper-studio-policy";
import { makeLayer, uid } from "./studio-templates";

export const LOCAL_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const LOCAL_IMAGE_MAX_DIMENSION = 4096;
export const LOCAL_IMAGE_MAX_COUNT = 30;

const IMG_DB = "gamevortex-wallpaper-studio";
const IMG_STORE = "images";

type StoredImage = { id: string; blob: Blob; createdAt: number };

function openImageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("INDEXED_DB_UNAVAILABLE"));
    const request = indexedDB.open(IMG_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IMG_STORE)) request.result.createObjectStore(IMG_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("INDEXED_DB_OPEN_FAILED"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openImageDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(IMG_STORE, mode);
      const request = run(tx.objectStore(IMG_STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? new Error("INDEXED_DB_TX_FAILED"));
      tx.onabort = () => reject(tx.error ?? new Error("INDEXED_DB_TX_ABORTED"));
    });
  } finally {
    db.close();
  }
}

export async function listLocalImages(): Promise<{ id: string; createdAt: number }[]> {
  const rows = await withStore<StoredImage[]>("readonly", (s) => s.getAll() as IDBRequest<StoredImage[]>);
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt })).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getLocalImage(id: string): Promise<Blob | null> {
  const row = await withStore<StoredImage | undefined>("readonly", (s) => s.get(id) as IDBRequest<StoredImage | undefined>);
  return row?.blob ?? null;
}

export async function putLocalImage(blob: Blob): Promise<string> {
  const existing = await listLocalImages();
  if (existing.length >= LOCAL_IMAGE_MAX_COUNT) throw new Error("LOCAL_IMAGE_LIMIT");
  const id = uid();
  await withStore("readwrite", (s) => s.put({ id, blob, createdAt: Date.now() } satisfies StoredImage));
  return id;
}

export async function deleteLocalImage(id: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(id));
}

export type ImageErrorCode = "NOT_AN_IMAGE" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "DECODE_FAILED";

export class StudioImageError extends Error {
  constructor(public readonly code: ImageErrorCode) {
    super(code);
  }
}

/**
 * يتحقق من الملف قبل قبوله: الحجم، نوع الصورة من البايتات (لا من الامتداد)، وإمكانية فك ترميزها.
 * الصور الأكبر من 4096px تُصغَّر لحماية ذاكرة الهاتف. GIF/WebP المتحرك يؤخذ منه الإطار الأول.
 */
export async function prepareImageFile(file: Blob): Promise<{ blob: Blob; bitmap: ImageBitmap }> {
  if (file.size === 0) throw new StudioImageError("NOT_AN_IMAGE");
  if (file.size > LOCAL_IMAGE_MAX_BYTES) throw new StudioImageError("TOO_LARGE");
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!sniffImageType(head)) throw new StudioImageError("UNSUPPORTED_TYPE");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new StudioImageError("DECODE_FAILED");
  }

  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= LOCAL_IMAGE_MAX_DIMENSION) return { blob: file, bitmap };

  const ratio = LOCAL_IMAGE_MAX_DIMENSION / longest;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new StudioImageError("DECODE_FAILED");
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const resized = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!resized) throw new StudioImageError("DECODE_FAILED");
  return { blob: resized, bitmap: await createImageBitmap(resized) };
}

/* -------------------------------------------------------------------------- */
/* تصاميم الزائر غير المسجل (localStorage)                                      */
/* -------------------------------------------------------------------------- */

export type LocalDesign = {
  id: string;
  name: string;
  background: StudioBackground;
  document: StudioDocument;
  updatedAt: string;
};

const LOCAL_DESIGNS_KEY = "gamevortex:wallpaper-studio:designs:v2";
const LEGACY_KEY = "gamevortex:wallpaper-studio:designs:v1";
const LEGACY_DONE_KEY = "gamevortex:wallpaper-studio:designs:v1-migrated";
export const LOCAL_DESIGNS_MAX = 20;

/** التصاميم القديمة (v1) كانت تحفظ حجم الخط في `size` وأنواع طبقات مختلفة؛ نحولها للشكل الحالي. */
function convertLegacy(item: unknown): LocalDesign | null {
  if (!item || typeof item !== "object") return null;
  const old = item as Record<string, unknown>;
  if (typeof old.name !== "string" || !Array.isArray(old.layers)) return null;
  const templateRaw = old.templateId === "islamic" ? "hijri" : old.templateId;
  const templateId: StudioTemplateId = (["cyber", "minimal", "esports", "hijri"] as const).includes(templateRaw as never) ? (templateRaw as StudioTemplateId) : "cyber";
  const effect = old.effect === "dim" || old.effect === "vignette" || old.effect === "grain" ? old.effect : "none";
  const layers: StudioLayer[] = [];
  for (const raw of old.layers as Record<string, unknown>[]) {
    if (!raw || typeof raw !== "object") continue;
    const kind = raw.kind === "date" ? "gregorian" : raw.kind === "title" ? "text" : raw.kind;
    if (kind !== "clock" && kind !== "gregorian" && kind !== "hijri" && kind !== "name" && kind !== "text") continue;
    layers.push(
      makeLayer({
        kind,
        text: typeof raw.text === "string" ? raw.text.slice(0, 300) : "",
        x: typeof raw.x === "number" ? raw.x : 540,
        y: typeof raw.y === "number" ? raw.y : 960,
        fontSize: typeof raw.size === "number" ? Math.min(400, Math.max(10, raw.size)) : 48,
        color: typeof raw.color === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.color) ? raw.color : "#ffffff",
        opacity: typeof raw.opacity === "number" ? Math.min(1, Math.max(0, raw.opacity)) : 1,
        visible: raw.visible !== false,
      }),
    );
  }
  const parsedDoc = studioDocumentSchema.safeParse({ v: 1, templateId, effect, target: old.target === "home" || old.target === "both" ? old.target : "lock", layers });
  if (!parsedDoc.success) return null;
  let background: StudioBackground = { kind: "none" };
  if (typeof old.background === "string") {
    const match = /^\/api\/wallpapers\/([^/?#]+)\/media/.exec(old.background);
    if (match) background = { kind: "library", wallpaperId: match[1] };
  }
  return {
    id: uid(),
    name: old.name.slice(0, 60) || "GameVortex Design",
    background,
    document: parsedDoc.data,
    updatedAt: typeof old.createdAt === "string" ? old.createdAt : new Date().toISOString(),
  };
}

export function readLocalDesigns(): LocalDesign[] {
  try {
    let list: LocalDesign[] = [];
    const raw = localStorage.getItem(LOCAL_DESIGNS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed.filter((d) => d && typeof d.id === "string" && studioDocumentSchema.safeParse(d.document).success);
    }
    if (!localStorage.getItem(LEGACY_DONE_KEY)) {
      const legacyRaw = localStorage.getItem(LEGACY_KEY);
      if (legacyRaw) {
        const legacy = JSON.parse(legacyRaw);
        if (Array.isArray(legacy)) {
          const converted = legacy.map(convertLegacy).filter((d): d is LocalDesign => d !== null);
          list = [...list, ...converted].slice(0, LOCAL_DESIGNS_MAX);
          localStorage.setItem(LOCAL_DESIGNS_KEY, JSON.stringify(list));
        }
      }
      localStorage.setItem(LEGACY_DONE_KEY, "1"); // نحتفظ بنسخة v1 الأصلية دون حذف
    }
    return list;
  } catch {
    return [];
  }
}

export function writeLocalDesigns(list: LocalDesign[]): boolean {
  try {
    localStorage.setItem(LOCAL_DESIGNS_KEY, JSON.stringify(list.slice(0, LOCAL_DESIGNS_MAX)));
    return true;
  } catch {
    return false;
  }
}
