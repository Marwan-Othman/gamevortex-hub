import { describe, expect, it } from "vitest";
import { isContentType, normalizeExternalSourceUrl } from "../lib/content-admin";

describe("normalizeExternalSourceUrl", () => {
  it("accepts a plain https link and drops the hash", () => {
    expect(normalizeExternalSourceUrl("https://example.com/files/app.apk#top")).toBe("https://example.com/files/app.apk");
    expect(normalizeExternalSourceUrl("  https://cdn.example.com/a.apk?token=1  ")).toBe("https://cdn.example.com/a.apk?token=1");
  });

  it("rejects non-https, credentials and malformed values", () => {
    expect(normalizeExternalSourceUrl("http://example.com/a.apk")).toBeNull();
    expect(normalizeExternalSourceUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeExternalSourceUrl("https://user:pass@example.com/a.apk")).toBeNull();
    expect(normalizeExternalSourceUrl("not a url")).toBeNull();
    expect(normalizeExternalSourceUrl("")).toBeNull();
    expect(normalizeExternalSourceUrl(null)).toBeNull();
    expect(normalizeExternalSourceUrl(42)).toBeNull();
  });

  it("rejects localhost, private and internal hosts", () => {
    for (const host of ["localhost", "127.0.0.1", "10.0.0.5", "192.168.1.9", "172.16.0.1", "169.254.169.254", "intranet", "printer.local", "db.internal", "[::1]"]) {
      expect(normalizeExternalSourceUrl(`https://${host}/a.apk`)).toBeNull();
    }
  });

  it("rejects overly long links", () => {
    expect(normalizeExternalSourceUrl(`https://example.com/${"a".repeat(2100)}`)).toBeNull();
  });
});

describe("isContentType", () => {
  it("only allows game and app", () => {
    expect(isContentType("game")).toBe(true);
    expect(isContentType("app")).toBe(true);
    expect(isContentType("mod")).toBe(false);
    expect(isContentType(undefined)).toBe(false);
  });
});
