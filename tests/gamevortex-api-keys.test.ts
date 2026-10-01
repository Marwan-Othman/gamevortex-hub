import { describe, expect, it } from "vitest";
import { createApiKey, hashApiKey, matchesApiKey } from "../lib/gamevortex-api/keys";

describe("GameVortex API keys", () => {
  it("generates a random token and stores only a one-way hash", () => {
    const first = createApiKey();
    const second = createApiKey();

    expect(first.key).toMatch(/^gvh_live_[A-Za-z0-9_-]{43}$/);
    expect(first.prefix).toBe(first.key.slice(0, 17));
    expect(first.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.secretHash).not.toContain(first.key);
    expect(second.secretHash).not.toBe(first.secretHash);
  });

  it("validates an issued key without accepting a different or malformed key", () => {
    const issued = createApiKey();

    expect(matchesApiKey(issued.key, issued.secretHash)).toBe(true);
    expect(matchesApiKey(createApiKey().key, issued.secretHash)).toBe(false);
    expect(matchesApiKey("not-a-key", issued.secretHash)).toBe(false);
    expect(() => hashApiKey("not-a-key")).toThrow("INVALID_API_KEY");
  });
});