import { describe, expect, it } from "vitest";
import { createApprovalToken, verifyApprovalToken } from "./approval";

describe("owner approval tokens", () => {
  it("creates a token bound to one opportunity and verifies it", () => {
    const approval = createApprovalToken("opp-123", 60);
    const result = verifyApprovalToken({
      opportunityId: "opp-123",
      token: approval.token,
      expectedTokenHash: approval.tokenHash,
      expiresAt: approval.expiresAt,
      now: new Date(approval.issuedAt),
    });

    expect(approval.token).not.toBe(approval.tokenHash);
    expect(approval.token).toHaveLength(43);
    expect(approval.tokenHash).toHaveLength(64);
    expect(result).toEqual({ valid: true });
  });

  it("rejects a token for a different opportunity", () => {
    const approval = createApprovalToken("opp-123", 60);
    const result = verifyApprovalToken({
      opportunityId: "opp-456",
      token: approval.token,
      expectedTokenHash: approval.tokenHash,
      expiresAt: approval.expiresAt,
      now: new Date(approval.issuedAt),
    });

    expect(result).toEqual({ valid: false, reason: "INVALID_TOKEN" });
  });

  it("rejects expired approvals", () => {
    const approval = createApprovalToken("opp-123", 60);
    const result = verifyApprovalToken({
      opportunityId: "opp-123",
      token: approval.token,
      expectedTokenHash: approval.tokenHash,
      expiresAt: approval.expiresAt,
      now: new Date(new Date(approval.expiresAt).getTime() + 1),
    });

    expect(result).toEqual({ valid: false, reason: "EXPIRED" });
  });

  it("rejects invalid TTL values", () => {
    expect(() => createApprovalToken("opp-123", 29)).toThrow("INVALID_APPROVAL_TTL");
    expect(() => createApprovalToken("opp-123", 901)).toThrow("INVALID_APPROVAL_TTL");
  });

  it("rejects malformed token hashes", () => {
    const approval = createApprovalToken("opp-123", 60);
    const result = verifyApprovalToken({
      opportunityId: "opp-123",
      token: approval.token,
      expectedTokenHash: "bad",
      expiresAt: approval.expiresAt,
    });

    expect(result).toEqual({ valid: false, reason: "INVALID_TOKEN" });
  });

  it("rejects blank opportunity identifiers", () => {
    expect(() => createApprovalToken("   ", 60)).toThrow("INVALID_APPROVAL_OPPORTUNITY");
  });
});
