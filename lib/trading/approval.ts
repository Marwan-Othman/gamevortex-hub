/**
 * GameVortex AI Trading — owner approval token primitives.
 *
 * Approval tokens are opaque, short-lived, and cryptographically bound to one
 * trading opportunity. Persistence stores only the hash; the plaintext token
 * is returned only when the approval is issued. This module never executes an
 * order or moves funds.
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

function normalizeOpportunityId(opportunityId: string): string {
  const normalized = opportunityId.trim();
  if (!normalized) throw new Error("INVALID_APPROVAL_OPPORTUNITY");
  return normalized;
}

function hashToken(opportunityId: string, token: string): Buffer {
  return createHash("sha256")
    .update(`${normalizeOpportunityId(opportunityId)}:${token}`, "utf8")
    .digest();
}

export function createApprovalToken(opportunityId: string, ttlSeconds = 5 * 60): ApprovalToken {
  const normalizedOpportunityId = normalizeOpportunityId(opportunityId);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < MIN_TTL_SECONDS || ttlSeconds > MAX_TTL_SECONDS) {
    throw new Error("INVALID_APPROVAL_TTL");
  }

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);
  const token = randomBytes(32).toString("base64url");

  return {
    token,
    tokenHash: hashToken(normalizedOpportunityId, token).toString("hex"),
    opportunityId: normalizedOpportunityId,
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
    const opportunityId = normalizeOpportunityId(input.opportunityId);
    if (!input.token || !/^[a-f0-9]{64}$/i.test(input.expectedTokenHash)) {
      return { valid: false, reason: "INVALID_TOKEN" };
    }

    const expiresAtMs = Date.parse(input.expiresAt);
    const nowMs = (input.now ?? new Date()).getTime();
    if (!Number.isFinite(expiresAtMs) || nowMs >= expiresAtMs) {
      return { valid: false, reason: "EXPIRED" };
    }

    const actual = hashToken(opportunityId, input.token);
    const expected = Buffer.from(input.expectedTokenHash, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(actual, expected)) {
      return { valid: false, reason: "INVALID_TOKEN" };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: "INVALID_TOKEN" };
  }
}
