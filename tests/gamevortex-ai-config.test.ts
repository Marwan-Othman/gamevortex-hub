import { describe, expect, it } from "vitest";
import { getRuntimeConfig } from "../lib/gamevortex-ai/config";

describe("GameVortex AI runtime configuration", () => {
  it("requires a runtime URL", () => {
    expect(() => getRuntimeConfig({})).toThrowError("RUNTIME_NOT_CONFIGURED");
  });

  it("allows direct local Ollama for development", () => {
    expect(getRuntimeConfig({ GAMEVORTEX_AI_RUNTIME_URL: "http://127.0.0.1:11434" })).toMatchObject({
      chatUrl: "http://127.0.0.1:11434/api/chat",
      healthUrl: "http://127.0.0.1:11434/api/tags",
      model: "qwen3:1.7b",
      local: true,
    });
  });

  it("requires a secret for a remote HTTPS gateway", () => {
    expect(() => getRuntimeConfig({ GAMEVORTEX_AI_RUNTIME_URL: "https://ai.example.test" })).toThrowError("RUNTIME_TOKEN_NOT_CONFIGURED");
    expect(getRuntimeConfig({
      GAMEVORTEX_AI_RUNTIME_URL: "https://ai.example.test",
      GAMEVORTEX_AI_RUNTIME_TOKEN: "0123456789abcdef".repeat(4),
      GAMEVORTEX_AI_MODEL: "qwen3:1.7b",
    })).toMatchObject({
      chatUrl: "https://ai.example.test/api/chat",
      healthUrl: "https://ai.example.test/health",
      local: false,
    });
  });

  it.each([
    "http://ai.example.test",
    "https://user:password@ai.example.test",
    "https://ai.example.test?token=secret",
    "https://ai.example.test/#fragment",
  ])("rejects unsafe remote runtime URL %s", (url) => {
    expect(() => getRuntimeConfig({
      GAMEVORTEX_AI_RUNTIME_URL: url,
      GAMEVORTEX_AI_RUNTIME_TOKEN: "0123456789abcdef".repeat(4),
    })).toThrowError("RUNTIME_CONFIGURATION_INVALID");
  });

  it("rejects weak remote runtime tokens", () => {
    expect(() => getRuntimeConfig({
      GAMEVORTEX_AI_RUNTIME_URL: "https://ai.example.test",
      GAMEVORTEX_AI_RUNTIME_TOKEN: "weak",
    })).toThrowError("RUNTIME_CONFIGURATION_INVALID");
  });
});
