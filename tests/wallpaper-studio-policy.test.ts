/**
 * Wallpaper Studio - pure policy: schema validation, VIP feature detection, save limits, image sniffing.
 */
import { describe, expect, it } from "vitest";
import {
  STUDIO_MAX_LAYERS,
  STUDIO_SAVE_LIMITS,
  StudioPolicyError,
  assertDocumentAllowed,
  listVipFeatures,
  requiredTier,
  saveLimitFor,
  studioDocumentSchema,
  studioSavePayloadSchema,
} from "@/lib/wallpaper-studio-policy";
import { sniffImageType } from "@/lib/image-sniff";
import { buildTemplateDocument, makeLayer, STUDIO_TEMPLATES } from "@/app/wallpapers/studio/studio-templates";

const free = { isVip: false, isOwner: false };
const vip = { isVip: true, isOwner: false };
const owner = { isVip: true, isOwner: true };

describe("studio document schema", () => {
  it("every built-in template produces a valid document", () => {
    for (const template of STUDIO_TEMPLATES) {
      const doc = buildTemplateDocument(template.id, "PLAYER");
      expect(studioDocumentSchema.safeParse(doc).success, template.id).toBe(true);
    }
  });

  it("rejects out-of-range values, bad colors, unknown fonts and too many layers", () => {
    const doc = buildTemplateDocument("cyber", "P");
    const bad = (patch: object) => studioDocumentSchema.safeParse({ ...doc, layers: [{ ...doc.layers[0], ...patch }] }).success;
    expect(bad({ opacity: 2 })).toBe(false);
    expect(bad({ color: "red" })).toBe(false);
    expect(bad({ fontFamily: "comic-sans" })).toBe(false);
    expect(bad({ fontSize: 5000 })).toBe(false);
    expect(bad({ text: "x".repeat(301) })).toBe(false);
    const many = { ...doc, layers: Array.from({ length: STUDIO_MAX_LAYERS + 1 }, () => makeLayer({ kind: "text", text: "a" })) };
    expect(studioDocumentSchema.safeParse(many).success).toBe(false);
  });

  it("a client-supplied isVip flag is stripped and never trusted", () => {
    const parsed = studioSavePayloadSchema.parse({
      name: "x",
      isVip: true,
      background: { kind: "none" },
      document: { ...buildTemplateDocument("cyber", "P"), isVip: true },
    });
    expect("isVip" in parsed).toBe(false);
    expect("isVip" in parsed.document).toBe(false);
  });
});

describe("VIP feature detection", () => {
  it("free templates, fonts and effects need no VIP", () => {
    const doc = buildTemplateDocument("cyber", "P");
    expect(listVipFeatures(doc)).toEqual([]);
    expect(requiredTier(doc)).toBe("FREE");
    expect(() => assertDocumentAllowed(doc, free)).not.toThrow();
  });

  it("pro templates, VIP effects, VIP fonts and glow are detected", () => {
    expect(requiredTier(buildTemplateDocument("royal", "P"))).toBe("VIP");
    expect(requiredTier({ ...buildTemplateDocument("cyber", "P"), effect: "grain" })).toBe("VIP");
    const withFont = { ...buildTemplateDocument("cyber", "P"), layers: [makeLayer({ kind: "text", text: "a", fontFamily: "impact" })] };
    expect(listVipFeatures(withFont)).toEqual([{ kind: "font", key: "impact" }]);
    const withGlow = { ...buildTemplateDocument("cyber", "P"), layers: [makeLayer({ kind: "text", text: "a", glow: true })] };
    expect(listVipFeatures(withGlow)).toEqual([{ kind: "glow", key: "glow" }]);
  });

  it("hidden layers do not count as VIP usage", () => {
    const doc = { ...buildTemplateDocument("cyber", "P"), layers: [makeLayer({ kind: "text", text: "a", fontFamily: "impact", glow: true, visible: false })] };
    expect(requiredTier(doc)).toBe("FREE");
  });

  it("free users are blocked, VIP and owner pass", () => {
    const doc = buildTemplateDocument("royal", "P");
    expect(() => assertDocumentAllowed(doc, free)).toThrowError(StudioPolicyError);
    expect(() => assertDocumentAllowed(doc, vip)).not.toThrow();
    expect(() => assertDocumentAllowed(doc, owner)).not.toThrow();
  });
});

describe("save limits", () => {
  it("free < VIP, owner unlimited", () => {
    expect(saveLimitFor(free)).toBe(STUDIO_SAVE_LIMITS.FREE);
    expect(saveLimitFor(vip)).toBe(STUDIO_SAVE_LIMITS.VIP);
    expect(saveLimitFor(vip)!).toBeGreaterThan(saveLimitFor(free)!);
    expect(saveLimitFor(owner)).toBeNull();
  });
});

describe("image sniffing (type comes from bytes, not from the file name)", () => {
  const pad = (bytes: number[]) => Uint8Array.from([...bytes, ...new Array(16).fill(0)]);
  it("recognises png, jpeg, gif and webp", () => {
    expect(sniffImageType(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImageType(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif");
    expect(sniffImageType(pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
  });
  it("rejects scripts, html, svg and truncated data", () => {
    const text = (s: string) => new TextEncoder().encode(s.padEnd(32, " "));
    expect(sniffImageType(text("<script>alert(1)</script>"))).toBeNull();
    expect(sniffImageType(text("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageType(text("<!doctype html>"))).toBeNull();
    expect(sniffImageType(new Uint8Array([0x89, 0x50]))).toBeNull();
  });
});
