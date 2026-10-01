/**
 * GameVortex AI Trading — owner approval token primitives.
 *
 * Tokens are short-lived, opaque, and bound to one opportunity. Persistence
 * must store only the hash and must atomically mark the approval as consumed
 * when an executor accepts it. This module never executes an order.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const MIN_TTL_SECONDS = 30;
const MAX_TTL_SECONDS = 15 * 60;

export type ApprovalToken = {
  token: string;
  tokenHash: string;
  opportunityId: string;
  issuedAt: string;
  expiresAt: string;
};

export type ApprovalVerification =
  | { valid: true }
  | { valid: false; reason: "INVALID_TOKEN" | "EXPIRED" };

function hashToken(opportunityId: string, token: string): Buffer {
  return createHash("sha256")
    .update(`${opportunityId}:${token}`, "utf8")
    .digest();
}

function validateOpportunityId(opportunityId: string): void {
  if (!opportunityId.trim()) throw new Error("INVALID_APPROVAL_OPPORTUNITY");
}

export function createApprovalToken(opportunityId: string, ttlSeconds = 5 * 60): ApprovalToken {
  validateOpportunityId(opportunityId);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < MIN_TTL_SECONDS || ttlSeconds > MAX_TTL_SECONDS) {
    throw new Error("INVALID_APPROVAL_TTL");
  }

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);
  const token = randomBytes(32).toString("base64url");

  return {
    token,
    tokenHash: hashToken(opportunityId, token).toString("hex"),
    opportunityId: opportunityId.trim(),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export function verifyApprovalToken(input: {
  opportunityId: string;
  token: string;
  expectedTokenHash: string;
  expiresAt: string;
  now?: Date;
}): ApprovalVerification {
  try {
    validateOpportunityId(input.opportunityId);
    if (!input.token || !/^[a-f0-9]{64}$/i.test(input.expectedTokenHash)) {
      return { valid: false, reason: "INVALID_TOKEN" };
    }

    const expiresAtMs = Date.parse(input.expiresAt);
    const nowMs = (input.now ?? new Date()).getTime();
    if (!Number.isFinite(expiresAtMs) || nowMs >= expiresAtMs) {
      return { valid: false, reason: "EXPIRED" };
    }

    const actual = hashToken(input.opportunityId.trim(), input.token);
    const expected = Buffer.from(input.expectedTokenHash, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(actual, expected)) {
      return { valid: false, reason: "INVALID_TOKEN" };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: "INVALID_TOKEN" };
  }
}
