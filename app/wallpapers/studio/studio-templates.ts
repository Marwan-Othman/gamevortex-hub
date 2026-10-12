import {
  STUDIO_H,
  STUDIO_TEMPLATE_TIERS,
  STUDIO_W,
  type StudioDocument,
  type StudioLayer,
  type StudioTemplateId,
  type StudioTier,
} from "@/lib/wallpaper-studio-policy";
import type { TemplateOverlay } from "./studio-render";

export function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export function makeLayer(patch: Partial<StudioLayer> & Pick<StudioLayer, "kind">): StudioLayer {
  const isClock = patch.kind === "clock";
  return {
    id: uid(),
    text: "",
    auto: patch.kind === "clock" || patch.kind === "gregorian" || patch.kind === "hijri",
    x: STUDIO_W / 2,
    y: STUDIO_H / 2,
    scale: 1,
    rotation: 0,
    opacity: 1,
    color: "#ffffff",
    fontSize: isClock ? 170 : 48,
    fontFamily: "sans",
    weight: isClock ? 300 : 600,
    align: "center",
    shadow: 18,
    glow: false,
    visible: true,
    clockFormat: "24",
    digits: "latn",
    dateStyle: "short",
    ...patch,
  };
}

export type TemplateDef = {
  id: StudioTemplateId;
  name: string;
  description: string;
  tier: StudioTier;
  accent: string;
  overlay: TemplateOverlay;
  build: (playerName: string) => StudioLayer[];
};

const base = (playerName: string, accent: string): StudioLayer[] => [
  makeLayer({ kind: "clock", y: 620 }),
  makeLayer({ kind: "gregorian", y: 770, fontSize: 42, opacity: 0.9 }),
  makeLayer({ kind: "hijri", y: 830, fontSize: 34, opacity: 0.78 }),
  makeLayer({ kind: "name", text: playerName || "PLAYER", y: 1080, fontSize: 64, color: accent, weight: 700 }),
];

const defs: Omit<TemplateDef, "tier">[] = [
  { id: "cyber", name: "Cyber Neon", description: "نيون + ساعة رقمية + هوية Gaming", accent: "#67e8f9", overlay: { top: "rgba(20,70,150,.20)", bottom: "rgba(20,70,150,.14)" }, build: (n) => base(n, "#67e8f9") },
  { id: "minimal", name: "Minimal", description: "نظيف وهادئ للشاشة الرئيسية", accent: "#ffffff", overlay: { top: "rgba(0,0,0,.12)", bottom: "rgba(0,0,0,.12)" }, build: (n) => base(n, "#ffffff").filter((l) => l.kind !== "name") },
  { id: "esports", name: "Esports", description: "اسم اللاعب + لقب احترافي", accent: "#fb7185", overlay: { top: "rgba(130,20,50,.24)", bottom: "rgba(40,0,20,.30)" }, build: (n) => [...base(n, "#fb7185"), makeLayer({ kind: "text", text: "PRO PLAYER", y: 1170, fontSize: 36, color: "#ffffff", opacity: 0.8 })] },
  { id: "hijri", name: "Hijri", description: "التاريخ الهجري بتصميم هادئ", accent: "#86efac", overlay: { top: "rgba(20,100,75,.22)", bottom: "rgba(0,40,30,.28)" }, build: (n) => [makeLayer({ kind: "clock", y: 560, fontSize: 150 }), makeLayer({ kind: "hijri", y: 720, fontSize: 52, color: "#86efac", opacity: 1, digits: "arab" }), makeLayer({ kind: "gregorian", y: 800, fontSize: 34, opacity: 0.8 }), makeLayer({ kind: "name", text: n || "PLAYER", y: 1100, fontSize: 56 })] },
  { id: "royal", name: "Royal Gold", description: "ذهبي فاخر بخط عريض", accent: "#fbbf24", overlay: { top: "rgba(60,40,0,.30)", bottom: "rgba(0,0,0,.40)" }, build: (n) => [makeLayer({ kind: "clock", y: 600, fontSize: 190, color: "#fbbf24", fontFamily: "impact", weight: 400, glow: true }), makeLayer({ kind: "gregorian", y: 760, fontSize: 40, color: "#fde68a", fontFamily: "impact", weight: 400 }), makeLayer({ kind: "hijri", y: 825, fontSize: 36, color: "#fde68a", fontFamily: "naskh", weight: 600 }), makeLayer({ kind: "name", text: n || "PLAYER", y: 1100, fontSize: 72, color: "#fbbf24", fontFamily: "impact", weight: 400 })] },
  { id: "glitch", name: "Glitch", description: "نمط رقمي حاد بخط Mono", accent: "#a3e635", overlay: { top: "rgba(0,30,0,.35)", bottom: "rgba(0,0,0,.45)" }, build: (n) => [makeLayer({ kind: "clock", y: 640, fontSize: 180, color: "#a3e635", fontFamily: "mono", weight: 700, glow: true }), makeLayer({ kind: "gregorian", y: 790, fontSize: 38, color: "#a3e635", fontFamily: "mono", weight: 600 }), makeLayer({ kind: "name", text: `> ${n || "PLAYER"}_`, y: 1080, fontSize: 54, color: "#a3e635", fontFamily: "mono", weight: 700 })] },
  { id: "aurora", name: "Aurora", description: "ألوان هادئة متدرجة مع توهج", accent: "#c4b5fd", overlay: { top: "rgba(80,40,160,.30)", bottom: "rgba(10,60,100,.34)" }, build: (n) => [makeLayer({ kind: "clock", y: 600, fontSize: 170, fontFamily: "rounded", weight: 300, glow: true, color: "#e9d5ff" }), makeLayer({ kind: "gregorian", y: 765, fontSize: 40, fontFamily: "rounded", color: "#c4b5fd" }), makeLayer({ kind: "hijri", y: 830, fontSize: 34, color: "#c4b5fd", fontFamily: "naskh" }), makeLayer({ kind: "name", text: n || "PLAYER", y: 1090, fontSize: 60, fontFamily: "rounded", color: "#e9d5ff" })] },
  { id: "bigclock", name: "Big Clock", description: "ساعة ضخمة تملأ الشاشة", accent: "#ffffff", overlay: { top: "rgba(0,0,0,.22)", bottom: "rgba(0,0,0,.34)" }, build: () => [makeLayer({ kind: "clock", y: 760, fontSize: 340, fontFamily: "impact", weight: 400, opacity: 0.95 }), makeLayer({ kind: "gregorian", y: 1000, fontSize: 56, fontFamily: "impact", weight: 400, opacity: 0.85 }), makeLayer({ kind: "hijri", y: 1080, fontSize: 44, fontFamily: "naskh", opacity: 0.8 })] },
];

export const STUDIO_TEMPLATES: TemplateDef[] = defs.map((d) => ({ ...d, tier: STUDIO_TEMPLATE_TIERS[d.id] }));

export function getTemplate(id: StudioTemplateId): TemplateDef {
  return STUDIO_TEMPLATES.find((t) => t.id === id) ?? STUDIO_TEMPLATES[0];
}

export function buildTemplateDocument(id: StudioTemplateId, playerName: string, target: StudioDocument["target"] = "lock"): StudioDocument {
  return { v: 1, templateId: id, effect: "none", target, layers: getTemplate(id).build(playerName) };
}
