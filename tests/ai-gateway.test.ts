import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  db: {
    gameVortexAiConversation: { findFirst: vi.fn(), update: vi.fn() },
    gameVortexAiMessage: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  },
  consumeAiCredit: vi.fn(),
  refundAiCredit: vi.fn(),
  runChatWithFailover: vi.fn(),
  getVipAccess: vi.fn(),
  startAiUsage: vi.fn(),
  finishAiUsage: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ db: m.db }));
vi.mock("@/lib/ai/credits", () => ({ consumeAiCredit: m.consumeAiCredit, refundAiCredit: m.refundAiCredit }));
vi.mock("@/lib/ai/provider-manager", () => ({ runChatWithFailover: m.runChatWithFailover }));
vi.mock("@/lib/vip", () => ({ getVipAccess: m.getVipAccess }));
vi.mock("@/lib/gamevortex-ai/site-context", () => ({ buildGameVortexSiteContext: vi.fn(async () => "") }));
vi.mock("@/lib/gamevortex-ai/usage-ledger", () => ({ startAiUsage: m.startAiUsage, finishAiUsage: m.finishAiUsage }));
vi.mock("@/lib/observability", () => ({ logSystemError: vi.fn(async () => undefined) }));

import { executeChat } from "../lib/ai/gateway";
import { AiProviderError } from "../lib/ai/types";

const base = { userId: "u1", conversationId: "c1", prompt: "hello", idempotencyKey: "key-0000001" };

beforeEach(() => {
  vi.clearAllMocks();
  m.db.gameVortexAiConversation.findFirst.mockResolvedValue({ id: "c1", title: "New AI Chat", systemInstructions: null, providerInteractionId: null, messages: [] });
  m.db.gameVortexAiMessage.findUnique.mockResolvedValue(null);
  m.db.gameVortexAiMessage.create.mockResolvedValue({});
  m.db.gameVortexAiMessage.deleteMany.mockResolvedValue({ count: 1 });
  m.db.gameVortexAiConversation.update.mockResolvedValue({});
  m.getVipAccess.mockResolvedValue({ isVip: true, isOwner: false });
  m.consumeAiCredit.mockResolvedValue({ consumed: true, alreadyApplied: false, amount: 1 });
  m.refundAiCredit.mockResolvedValue({ refunded: true });
  m.startAiUsage.mockResolvedValue({ usage: { id: "usage1" }, alreadyApplied: false });
  m.finishAiUsage.mockResolvedValue({});
  m.runChatWithFailover.mockResolvedValue({
    result: { provider: "gemini", model: "m", answer: "hi there", latencyMs: 5 },
    attempts: [{ provider: "gemini", result: { provider: "gemini", model: "m", answer: "hi there", latencyMs: 5 } }],
  });
});

describe("executeChat", () => {
  it("returns { answer } and stores the assistant message under a user-scoped key", async () => {
    const result = await executeChat(base);
    expect(result.answer).toBe("hi there");
    const keys = m.db.gameVortexAiMessage.create.mock.calls.map((call: any[]) => call[0].data.idempotencyKey);
    expect(keys).toEqual(["u1:key-0000001", "u1:key-0000001:assistant"]);
    expect(m.refundAiCredit).not.toHaveBeenCalled();
  });

  it.each(["AI_CREDITS_EXHAUSTED", "AI_VIP_REQUIRED", "AI_IDEMPOTENCY_KEY_CONFLICT"])("passes %s through instead of hiding it as 'service unavailable'", async (code) => {
    m.consumeAiCredit.mockRejectedValue(new Error(code));
    await expect(executeChat(base)).rejects.toThrow(code);
    expect(m.runChatWithFailover).not.toHaveBeenCalled();
    expect(m.db.gameVortexAiMessage.deleteMany).toHaveBeenCalled();
  });

  it("refunds once, removes the orphaned user message and records the failed attempts when every provider fails", async () => {
    const failure = new AiProviderError({ provider: "manus", code: "UNAVAILABLE", retryable: true });
    failure.attempts = [
      { provider: "gemini", error: new AiProviderError({ provider: "gemini", code: "RATE_LIMITED" }) },
      { provider: "manus", error: failure },
    ];
    m.runChatWithFailover.mockRejectedValue(failure);
    await expect(executeChat(base)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(m.refundAiCredit).toHaveBeenCalledTimes(1);
    expect(m.db.gameVortexAiMessage.deleteMany).toHaveBeenCalled();
    expect(m.finishAiUsage).toHaveBeenCalledTimes(2);
  });

  it("does not refund a reservation that belonged to an earlier request (replayed key)", async () => {
    m.consumeAiCredit.mockResolvedValue({ consumed: true, alreadyApplied: true, amount: 1 });
    m.runChatWithFailover.mockRejectedValue(new AiProviderError({ provider: "gemini", code: "TIMEOUT" }));
    await expect(executeChat(base)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(m.refundAiCredit).not.toHaveBeenCalled();
  });

  it("never charges or refunds the owner", async () => {
    m.getVipAccess.mockResolvedValue({ isVip: true, isOwner: true });
    await executeChat(base);
    expect(m.consumeAiCredit).not.toHaveBeenCalled();
    m.runChatWithFailover.mockRejectedValue(new AiProviderError({ provider: "gemini", code: "TIMEOUT" }));
    await expect(executeChat({ ...base, idempotencyKey: "key-0000002" })).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(m.refundAiCredit).not.toHaveBeenCalled();
  });

  it("still returns a paid answer when saving the conversation fails afterwards", async () => {
    m.db.gameVortexAiConversation.update.mockRejectedValue(new Error("db down"));
    m.startAiUsage.mockRejectedValue(new Error("ledger down"));
    const result = await executeChat(base);
    expect(result.answer).toBe("hi there");
    expect(m.refundAiCredit).not.toHaveBeenCalled();
  });

  it("replays a finished request from the stored answer without calling the provider or charging again", async () => {
    m.db.gameVortexAiMessage.findUnique
      .mockResolvedValueOnce({ id: "msg1", createdAt: new Date(), conversationId: "c1", content: "hello" })
      .mockResolvedValueOnce({ content: "stored answer" });
    const result = await executeChat(base);
    expect(result.answer).toBe("stored answer");
    expect(m.consumeAiCredit).not.toHaveBeenCalled();
    expect(m.runChatWithFailover).not.toHaveBeenCalled();
  });

  it("rejects a key reused for a different prompt or conversation, and an in-flight duplicate", async () => {
    m.db.gameVortexAiMessage.findUnique.mockResolvedValueOnce({ id: "msg1", createdAt: new Date(), conversationId: "c1", content: "another prompt" });
    await expect(executeChat(base)).rejects.toThrow("AI_IDEMPOTENCY_KEY_CONFLICT");
    m.db.gameVortexAiMessage.findUnique
      .mockResolvedValueOnce({ id: "msg1", createdAt: new Date(), conversationId: "c1", content: "hello" })
      .mockResolvedValueOnce(null);
    await expect(executeChat(base)).rejects.toThrow("AI_REQUEST_IN_PROGRESS");
  });

  it("validates the prompt and the conversation owner before touching credits", async () => {
    await expect(executeChat({ ...base, prompt: "   " })).rejects.toThrow("INVALID_REQUEST");
    await expect(executeChat({ ...base, prompt: "x".repeat(6001) })).rejects.toThrow("INVALID_REQUEST");
    m.db.gameVortexAiConversation.findFirst.mockResolvedValue(null);
    await expect(executeChat(base)).rejects.toThrow("CONVERSATION_NOT_FOUND");
    expect(m.consumeAiCredit).not.toHaveBeenCalled();
  });

  it("requires VIP", async () => {
    m.getVipAccess.mockResolvedValue({ isVip: false, isOwner: false });
    await expect(executeChat(base)).rejects.toThrow("AI_VIP_REQUIRED");
  });
});
