import { describe, expect, it } from "vitest";
import { getRuntimeConfig } from "../lib/gamevortex-ai/config";

describe("GameVortex AI runtime configuration", () => {
  it("requires a server-side Manus API key", () => {
    expect(() => getRuntimeConfig({})).toThrowError("MANUS_NOT_CONFIGURED");
  });

  it("accepts a valid server-side Manus configuration", () => {
    expect(
      getRuntimeConfig({
        MANUS_API_KEY: "0123456789abcdef0123",
      }),
    ).toEqual({
      provider: "manus",
      model: "manus",
    });
  });

  it("rejects weak API keys", () => {
    expect(() =>
      getRuntimeConfig({
        MANUS_API_KEY: "weak",
      }),
    ).toThrowError("MANUS_CONFIGURATION_INVALID");
  });

  it("rejects API keys containing newlines", () => {
    expect(() =>
      getRuntimeConfig({
        MANUS_API_KEY: "0123456789abcdef0123\nsecret",
      }),
    ).toThrowError("MANUS_CONFIGURATION_INVALID");
  });

  it("does not expose the API key in the returned runtime configuration", () => {
    const config = getRuntimeConfig({
      MANUS_API_KEY: "0123456789abcdef0123",
    });

    expect(config).not.toHaveProperty("apiKey");
    expect(config).not.toHaveProperty("MANUS_API_KEY");
  });
});
