import { describe, expect, it } from "vitest";
import {
  parseImageData,
  pickAspectRatio,
  pickImageSize,
  pickVideoAspectRatio,
  pickVideoResolution,
  readIdempotencyKey,
} from "../lib/ai/validation";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHnOcMAAAAABJRU5ErkJggg==";

describe("AI request validation", () => {
  it("uses the fallback key when none is sent and rejects malformed ones", () => {
    expect(readIdempotencyKey(undefined, "fallback-1234")).toBe("fallback-1234");
    expect(readIdempotencyKey("", "fallback-1234")).toBe("fallback-1234");
    expect(readIdempotencyKey("  abcdefgh-1234  ", "x")).toBe("abcdefgh-1234");
    expect(readIdempotencyKey("short", "x")).toBeNull();
    expect(readIdempotencyKey("has space in it", "x")).toBeNull();
    expect(readIdempotencyKey("a".repeat(129), "x")).toBeNull();
    expect(readIdempotencyKey(42, "x")).toBeNull();
  });

  it("accepts only png/jpeg/webp base64 data URLs within the size limit", () => {
    expect(parseImageData(PNG).mimeType).toBe("image/png");
    expect(() => parseImageData("data:image/gif;base64,AAAAAAAAAAAAAAAAAAAA")).toThrow("INVALID_IMAGE_INPUT");
    expect(() => parseImageData("data:image/png;base64,@@@@@@@@@@@@@@@@@@@@")).toThrow("INVALID_IMAGE_INPUT");
    expect(() => parseImageData("not a data url")).toThrow("INVALID_IMAGE_INPUT");
    expect(() => parseImageData("data:image/png;base64," + "A".repeat(4_000_000))).toThrow("INVALID_IMAGE_INPUT");
  });

  it("whitelists provider options: undefined when absent, null when not allowed", () => {
    expect(pickImageSize(undefined)).toBeUndefined();
    expect(pickImageSize("2K")).toBe("2K");
    expect(pickImageSize("8K")).toBeNull();
    expect(pickAspectRatio("16:9")).toBe("16:9");
    expect(pickAspectRatio("1:99")).toBeNull();
    expect(pickVideoAspectRatio("9:16")).toBe("9:16");
    expect(pickVideoAspectRatio("1:1")).toBeNull();
    expect(pickVideoResolution("720p")).toBe("720p");
    expect(pickVideoResolution("4k")).toBeNull();
  });
});
