/**
 * GameVortex Wallpaper Studio — سياسة الصلاحيات والتحقق من التصميم.
 *
 * ملف نقي (بدون قاعدة بيانات) يُستعمل في الخادم وفي المتصفح:
 *  - الخادم يعتمد عليه للتحقق من أي تصميم قبل حفظه (المصدر الموثوق).
 *  - المتصفح يعتمد عليه فقط لعرض الأقفال؛ لا يُعتمد على المتصفح للأمان.
 *
 * لا يوجد هنا نظام VIP جديد: حالة الاشتراك تأتي من `getVipAccess` في lib/vip.ts.
 */
import { z } from "zod";

export const STUDIO_W = 1080;
export const STUDIO_H = 1920;

/* -------------------------------------------------------------------------- */
/* حدود الحفظ — قابلة للتعديل من هذا المكان فقط                                */
/* -------------------------------------------------------------------------- */

/**
 * ملاحظة: لم يكن في المشروع أي حد سابق لحفظ التصاميم، لذلك هذه القيم افتراضية
 * وقائية لمنع إساءة الاستخدام وتحتاج موافقة المالك. المالك (SUPER_ADMIN) بلا حد.
 */
export const STUDIO_SAVE_LIMITS = {
  FREE: 5,
  VIP: 50,
} as const;

export const STUDIO_MAX_LAYERS = 40;
export const STUDIO_MAX_TEXT = 300;
export const STUDIO_MAX_DOCUMENT_BYTES = 64 * 1024;

/* -------------------------------------------------------------------------- */
/* الخطوط والتأثيرات والقوالب                                                  */
/* -------------------------------------------------------------------------- */

export type StudioTier = "FREE" | "VIP";

/** خطوط النظام فقط (لا تحميل ملفات خارجية). توفرها يعتمد على جهاز المستخدم. */
export const STUDIO_FONTS = {
  sans: { label: "Sans", stack: 'Arial, "Segoe UI", Tahoma, sans-serif', tier: "FREE" },
  tahoma: { label: "Tahoma", stack: 'Tahoma, Arial, sans-serif', tier: "FREE" },
  serif: { label: "Serif", stack: 'Georgia, "Times New Roman", serif', tier: "FREE" },
  impact: { label: "Impact", stack: 'Impact, "Arial Black", sans-serif', tier: "VIP" },
  mono: { label: "Mono", stack: '"Courier New", Courier, monospace', tier: "VIP" },
  rounded: { label: "Rounded", stack: '"Trebuchet MS", "Segoe UI", sans-serif', tier: "VIP" },
  naskh: { label: "Naskh", stack: '"Traditional Arabic", "Amiri", "Noto Naskh Arabic", serif', tier: "VIP" },
} as const satisfies Record<string, { label: string; stack: string; tier: StudioTier }>;
export type StudioFontKey = keyof typeof STUDIO_FONTS;
export const STUDIO_FONT_KEYS = Object.keys(STUDIO_FONTS) as [StudioFontKey, ...StudioFontKey[]];

export const STUDIO_EFFECTS = {
  none: { label: "بدون", tier: "FREE" },
  dim: { label: "تعتيم", tier: "FREE" },
  vignette: { label: "Vignette", tier: "VIP" },
  grain: { label: "Grain", tier: "VIP" },
  blue: { label: "Blue Tone", tier: "VIP" },
  fade: { label: "تدرج سفلي", tier: "VIP" },
  light: { label: "إضاءة مركزية", tier: "VIP" },
} as const satisfies Record<string, { label: string; tier: StudioTier }>;
export type StudioEffectKey = keyof typeof STUDIO_EFFECTS;
export const STUDIO_EFFECT_KEYS = Object.keys(STUDIO_EFFECTS) as [StudioEffectKey, ...StudioEffectKey[]];

/** معرّفات القوالب ومستواها. تفاصيل التخطيط في الواجهة. */
export const STUDIO_TEMPLATE_TIERS = {
  cyber: "FREE",
  minimal: "FREE",
  esports: "VIP",
  hijri: "VIP",
  royal: "VIP",
  glitch: "VIP",
  aurora: "VIP",
  bigclock: "VIP",
} as const satisfies Record<string, StudioTier>;
export type StudioTemplateId = keyof typeof STUDIO_TEMPLATE_TIERS;
export const STUDIO_TEMPLATE_IDS = Object.keys(STUDIO_TEMPLATE_TIERS) as [StudioTemplateId, ...StudioTemplateId[]];

/* -------------------------------------------------------------------------- */
/* مخطط التصميم                                                                */
/* -------------------------------------------------------------------------- */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const studioLayerSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(["clock", "gregorian", "hijri", "text", "name"]),
  text: z.string().max(STUDIO_MAX_TEXT),
  /** true = الساعة/التاريخ تتحدث تلقائيًا ويتجاهل التصدير `text`. */
  auto: z.boolean(),
  x: z.number().min(-600).max(STUDIO_W + 600),
  y: z.number().min(-600).max(STUDIO_H + 600),
  scale: z.number().min(0.1).max(6),
  rotation: z.number().min(-360).max(360),
  opacity: z.number().min(0).max(1),
  color: hexColor,
  fontSize: z.number().min(10).max(400),
  fontFamily: z.enum(STUDIO_FONT_KEYS),
  weight: z.number().int().min(300).max(900),
  align: z.enum(["left", "center", "right"]),
  shadow: z.number().min(0).max(60),
  /** توهج — ميزة VIP. */
  glow: z.boolean(),
  visible: z.boolean(),
  clockFormat: z.enum(["24", "12"]),
  digits: z.enum(["latn", "arab"]),
  dateStyle: z.enum(["short", "long"]),
});
export type StudioLayer = z.infer<typeof studioLayerSchema>;

export const studioDocumentSchema = z.object({
  v: z.literal(1),
  templateId: z.enum(STUDIO_TEMPLATE_IDS),
  effect: z.enum(STUDIO_EFFECT_KEYS),
  target: z.enum(["home", "lock", "both"]),
  layers: z.array(studioLayerSchema).max(STUDIO_MAX_LAYERS),
});
export type StudioDocument = z.infer<typeof studioDocumentSchema>;

export const studioBackgroundSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("library"), wallpaperId: z.string().min(1).max(100) }),
  /** صورة خاصة من هاتف المستخدم: تبقى في متصفحه ولا تُرفع. */
  z.object({ kind: z.literal("local"), localId: z.string().min(1).max(64) }),
]);
export type StudioBackground = z.infer<typeof studioBackgroundSchema>;

export const studioSavePayloadSchema = z.object({
  name: z.string().trim().min(1).max(60),
  background: studioBackgroundSchema,
  document: studioDocumentSchema,
});
export type StudioSavePayload = z.infer<typeof studioSavePayloadSchema>;

/* -------------------------------------------------------------------------- */
/* المستوى المطلوب والتحقق من الصلاحية                                          */
/* -------------------------------------------------------------------------- */

export type StudioVipFeature = { kind: "template" | "font" | "effect" | "glow"; key: string };

/** يرجع كل عنصر VIP مستخدم داخل التصميم. */
export function listVipFeatures(doc: StudioDocument): StudioVipFeature[] {
  const found: StudioVipFeature[] = [];
  if (STUDIO_TEMPLATE_TIERS[doc.templateId] === "VIP") found.push({ kind: "template", key: doc.templateId });
  if (STUDIO_EFFECTS[doc.effect].tier === "VIP") found.push({ kind: "effect", key: doc.effect });
  const seenFonts = new Set<string>();
  let glow = false;
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    if (STUDIO_FONTS[layer.fontFamily].tier === "VIP" && !seenFonts.has(layer.fontFamily)) {
      seenFonts.add(layer.fontFamily);
      found.push({ kind: "font", key: layer.fontFamily });
    }
    if (layer.glow) glow = true;
  }
  if (glow) found.push({ kind: "glow", key: "glow" });
  return found;
}

export function requiredTier(doc: StudioDocument): StudioTier {
  return listVipFeatures(doc).length > 0 ? "VIP" : "FREE";
}

export type StudioAccessLike = { isVip: boolean; isOwner: boolean };

export function saveLimitFor(access: StudioAccessLike): number | null {
  if (access.isOwner) return null; // المالك بلا حدود
  return access.isVip ? STUDIO_SAVE_LIMITS.VIP : STUDIO_SAVE_LIMITS.FREE;
}

export class StudioPolicyError extends Error {
  constructor(public readonly code: "VIP_REQUIRED" | "SAVE_LIMIT_REACHED" | "INVALID_DESIGN", message?: string) {
    super(message ?? code);
    this.name = "StudioPolicyError";
  }
}

/** يرمي VIP_REQUIRED إذا استعمل مستخدم غير VIP عنصرًا من عناصر VIP. */
export function assertDocumentAllowed(doc: StudioDocument, access: StudioAccessLike): void {
  if (access.isVip || access.isOwner) return;
  if (requiredTier(doc) === "VIP") throw new StudioPolicyError("VIP_REQUIRED");
}

/* -------------------------------------------------------------------------- */
/* أذكار وعبارات جاهزة                                                          */
/* -------------------------------------------------------------------------- */

export const STUDIO_ADHKAR = [
  "سبحان الله وبحمده، سبحان الله العظيم",
  "لا إله إلا الله وحده لا شريك له، له الملك وله الحمد وهو على كل شيء قدير",
  "أستغفر الله العظيم وأتوب إليه",
  "لا حول ولا قوة إلا بالله",
  "اللهم صلِّ وسلِّم على نبينا محمد",
  "حسبي الله لا إله إلا هو عليه توكلت وهو رب العرش العظيم",
  "الحمد لله رب العالمين",
  "رب اشرح لي صدري ويسر لي أمري",
] as const;

export const STUDIO_PHRASES = ["GG", "LEVEL UP", "NEVER GIVE UP", "PLAY HARD", "GAME ON"] as const;
