import { describe, expect, it } from "vitest";
import {
  detectImageType,
  isContentType,
  looksLikeApk,
  normalizeExternalSourceUrl,
  parseCategoryValues,
  parseVersionValue,
} from "../lib/content-admin";

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

describe("parseCategoryValues", () => {
  it("treats a missing field as 'leave unchanged'", () => {
    expect(parseCategoryValues(undefined)).toBeNull();
    expect(parseCategoryValues(null)).toBeNull();
  });

  it("keeps unique, trimmed ids and allows an explicit empty list", () => {
    expect(parseCategoryValues([" a1 ", "b2", "a1"])).toEqual(["a1", "b2"]);
    expect(parseCategoryValues([])).toEqual([]);
  });

  it("rejects wrong shapes, blanks, long values and too many items", () => {
    expect(parseCategoryValues("action")).toBe("INVALID");
    expect(parseCategoryValues([1])).toBe("INVALID");
    expect(parseCategoryValues(["  "])).toBe("INVALID");
    expect(parseCategoryValues(["x".repeat(81)])).toBe("INVALID");
    expect(parseCategoryValues(Array.from({ length: 21 }, (_, i) => `c${i}`))).toBe("INVALID");
  });
});

describe("parseVersionValue", () => {
  it("treats a missing field as 'leave unchanged' and blank as cleared", () => {
    expect(parseVersionValue(undefined)).toBeUndefined();
    expect(parseVersionValue(null)).toBeNull();
    expect(parseVersionValue("   ")).toBeNull();
  });

  it("keeps normal release versions", () => {
    expect(parseVersionValue(" 1.2.3 ")).toBe("1.2.3");
    expect(parseVersionValue("v2.0-beta")).toBe("v2.0-beta");
    expect(parseVersionValue("19.7.0  (build 4)")).toBe("19.7.0 (build 4)");
    expect(parseVersionValue("1.0\n2.0")).toBe("1.0 2.0");
  });

  it("rejects markup, wrong types and overly long values", () => {
    expect(parseVersionValue("<script>")).toBe("INVALID");
    expect(parseVersionValue(".1")).toBe("INVALID");
    expect(parseVersionValue(12)).toBe("INVALID");
    expect(parseVersionValue("1".repeat(41))).toBe("INVALID");
  });
});

describe("file signatures", () => {
  it("recognises an APK (ZIP) header and rejects anything else", () => {
    expect(looksLikeApk([0x50, 0x4b, 0x03, 0x04])).toBe(true);
    expect(looksLikeApk([0x50, 0x4b, 0x05, 0x06])).toBe(false); // empty zip
    expect(looksLikeApk([0x4d, 0x5a, 0x90, 0x00])).toBe(false); // .exe
    expect(looksLikeApk([0x50, 0x4b])).toBe(false);
  });

  it("detects real image types by their first bytes", () => {
    const bytes = (text: string, offset = 0) => [...Array(offset).fill(0), ...[...text].map((c) => c.charCodeAt(0))];
    expect(detectImageType([0xff, 0xd8, 0xff, 0xe0])).toBe("image/jpeg");
    expect(detectImageType([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])).toBe("image/png");
    expect(detectImageType([...bytes("RIFF"), 0, 0, 0, 0, ...bytes("WEBP")])).toBe("image/webp");
    expect(detectImageType([0, 0, 0, 0x1c, ...bytes("ftypavif")])).toBe("image/avif");
    expect(detectImageType(bytes("<html><body>"))).toBeNull();
    expect(detectImageType([0x50, 0x4b, 0x03, 0x04])).toBeNull();
    expect(detectImageType([])).toBeNull();
  });
});
