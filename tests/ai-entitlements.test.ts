import { describe, expect, it } from "vitest";
import {
  OWNER_AI_ENTITLEMENTS,
  getAiEntitlementsForRole,
  hasOwnerAiAccess,
} from "../lib/ai/entitlements";

describe("GameVortex AI owner entitlements", () => {
  it("recognizes SUPER_ADMIN as the owner role", () => {
    expect(hasOwnerAiAccess("SUPER_ADMIN")).toBe(true);
    expect(hasOwnerAiAccess("STAFF")).toBe(false);
    expect(hasOwnerAiAccess("USER")).toBe(false);
    expect(hasOwnerAiAccess(undefined)).toBe(false);
  });

  it("gives the owner quota-free product entitlements", () => {
    expect(getAiEntitlementsForRole("SUPER_ADMIN")).toEqual({
      unlimited: true,
      ...OWNER_AI_ENTITLEMENTS,
    });
  });

  it("does not grant owner entitlements to normal roles", () => {
    expect(getAiEntitlementsForRole("STAFF")).toEqual({
      unlimited: false,
      chatCredits: 0,
      imageCredits: 0,
      videoCredits: 0,
    });
  });
});
