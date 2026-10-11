import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findFirst: vi.fn(),
  geminiChat: vi.fn(),
  manusChat: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ db: { aiUsageLedger: { findFirst: m.findFirst } } }));
vi.mock("@/lib/ai/gemini", () => ({ geminiChat: m.geminiChat, geminiHealth: vi.fn() }));
vi.mock("@/lib/ai/manus", () => ({ manusChat: m.manusChat }));

import { runChatWithFailover } from "../lib/ai/provider-manager";
import { AiProviderError } from "../lib/ai/types";

const ok = (provider: "gemini" | "manus", answer = "answer") => ({ provider, model: "m", answer, latencyMs: 1 });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = "g";
  process.env.MANUS_API_KEY = "m";
  m.findFirst.mockResolvedValue(null);
});

describe("runChatWithFailover", () => {
  it("fails over from a failoverable Gemini error to Manus", async () => {
    m.geminiChat.mockRejectedValue(new AiProviderError({ provider: "gemini", code: "RATE_LIMITED", failoverable: true }));
    m.manusChat.mockResolvedValue(ok("manus"));
    const { result, attempts } = await runChatWithFailover({ prompt: "hi" });
    expect(result.provider).toBe("manus");
    expect(attempts).toHaveLength(2);
  });

  it("treats an empty answer as a failure and fails over", async () => {
    m.geminiChat.mockResolvedValue(ok("gemini", "   "));
    m.manusChat.mockResolvedValue(ok("manus"));
    const { result } = await runChatWithFailover({ prompt: "hi" });
    expect(result.provider).toBe("manus");
  });

  it("does not fail over on a non-failoverable error and exposes every attempt on the thrown error", async () => {
    m.geminiChat.mockRejectedValue(new AiProviderError({ provider: "gemini", code: "PROVIDER_ERROR", status: 422 }));
    let thrown: any;
    try { await runChatWithFailover({ prompt: "hi" }); } catch (error) { thrown = error; }
    expect(thrown.code).toBe("PROVIDER_ERROR");
    expect(thrown.attempts).toHaveLength(1);
    expect(m.manusChat).not.toHaveBeenCalled();
  });

  it("reports NO_PROVIDER_AVAILABLE when nothing is configured", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.MANUS_API_KEY;
    await expect(runChatWithFailover({ prompt: "hi" })).rejects.toMatchObject({ code: "NO_PROVIDER_AVAILABLE" });
  });

  it("only lets chat failures put Gemini into cooldown", async () => {
    await runChatWithFailover({ prompt: "hi" }).catch(() => undefined);
    const where = m.findFirst.mock.calls[0][0].where;
    expect(where.operation).toEqual({ in: ["CHAT", "ADVANCED_CHAT"] });
  });
});
