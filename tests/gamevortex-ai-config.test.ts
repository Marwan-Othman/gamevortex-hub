import { describe, expect, it } from "vitest";
import { getRuntimeConfig } from "../lib/gamevortex-ai/config";

describe("GameVortex AI runtime configuration", () => {
  it("requires a server-side Gemini API key", () => { expect(() => getRuntimeConfig({})).toThrowError("GEMINI_NOT_CONFIGURED"); });
  it("accepts a valid server-side Gemini configuration", () => { expect(getRuntimeConfig({ GEMINI_API_KEY: "0123456789abcdef0123", GEMINI_MODEL: "gemini-3.1-flash-lite" })).toEqual({ model: "gemini-3.1-flash-lite" }); });
  it("uses the default Gemini model when none is supplied", () => { expect(getRuntimeConfig({ GEMINI_API_KEY: "0123456789abcdef0123" })).toEqual({ model: "gemini-3.1-flash-lite" }); });
  it("rejects weak API keys", () => { expect(() => getRuntimeConfig({ GEMINI_API_KEY: "weak" })).toThrowError("GEMINI_CONFIGURATION_INVALID"); });
  it("rejects empty models", () => { expect(() => getRuntimeConfig({ GEMINI_API_KEY: "0123456789abcdef0123", GEMINI_MODEL: " " })).toThrowError("GEMINI_CONFIGURATION_INVALID"); });
  it("rejects models containing control or whitespace characters", () => { expect(() => getRuntimeConfig({ GEMINI_API_KEY: "0123456789abcdef0123", GEMINI_MODEL: "gemini model" })).toThrowError("GEMINI_CONFIGURATION_INVALID"); });
  it("rejects excessively long models", () => { expect(() => getRuntimeConfig({ GEMINI_API_KEY: "0123456789abcdef0123", GEMINI_MODEL: "m".repeat(129) })).toThrowError("GEMINI_CONFIGURATION_INVALID"); });
  it("does not expose the API key in the returned runtime configuration", () => { const config = getRuntimeConfig({ GEMINI_API_KEY: "0123456789abcdef0123" }); expect(config).not.toHaveProperty("apiKey"); expect(config).not.toHaveProperty("GEMINI_API_KEY"); });
});
