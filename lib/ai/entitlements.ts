/**
 * GameVortex AI entitlement policy.
 *
 * SUPER_ADMIN is the owner role. Owner AI access is intentionally quota-free
 * for chat, image generation, and video generation. This is a quota policy,
 * not a promise that an external provider can process an unlimited number of
 * jobs or that provider billing/limits disappear.
 */

export const OWNER_AI_UNLIMITED = true as const;

export const OWNER_AI_ENTITLEMENTS = Object.freeze({
  chatCredits: Number.MAX_SAFE_INTEGER,
  imageCredits: Number.MAX_SAFE_INTEGER,
  videoCredits: Number.MAX_SAFE_INTEGER,
});

export function hasOwnerAiAccess(role: string | null | undefined): boolean {
  return role === "SUPER_ADMIN";
}

export function getAiEntitlementsForRole(role: string | null | undefined) {
  if (hasOwnerAiAccess(role)) {
    return {
      unlimited: OWNER_AI_UNLIMITED,
      ...OWNER_AI_ENTITLEMENTS,
    };
  }

  return {
    unlimited: false,
    chatCredits: 0,
    imageCredits: 0,
    videoCredits: 0,
  };
}
