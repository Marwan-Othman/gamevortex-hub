import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getOptionalUser: vi.fn(),
  guardMutation: vi.fn(),
  guardRead: vi.fn(),
  rateLimitAsync: vi.fn(),
  executeChat: vi.fn(),
  consumeAiCredit: vi.fn(),
  refundAiCredit: vi.fn(),
  generateImage: vi.fn(),
  startVideo: vi.fn(),
  getVipAccess: vi.fn(),
  recordMediaUsage: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    constructor(body?: BodyInit | null, init?: ResponseInit) { super(body as BodyInit, init); }
    static json(body: unknown, init?: ResponseInit) {
      const headers = new Headers(init?.headers);
      headers.set("content-type", "application/json");
      return new Response(JSON.stringify(body), { ...init, headers });
    }
  },
}));
vi.mock("@/lib/auth", () => ({ getOptionalUser: m.getOptionalUser }));
vi.mock("@/lib/api", () => ({ guardMutation: m.guardMutation, guardRead: m.guardRead }));
vi.mock("@/lib/security", () => ({ rateLimitAsync: m.rateLimitAsync }));
vi.mock("@/lib/ai/gateway", () => ({ executeChat: m.executeChat }));
vi.mock("@/lib/ai/credits", () => ({ consumeAiCredit: m.consumeAiCredit, refundAiCredit: m.refundAiCredit }));
vi.mock("@/lib/ai/media", () => ({ generateImage: m.generateImage, startVideo: m.startVideo }));
vi.mock("@/lib/ai/media-usage", () => ({ recordMediaUsage: m.recordMediaUsage }));
vi.mock("@/lib/vip", () => ({ getVipAccess: m.getVipAccess }));

import { POST as chatPost } from "../app/api/ai/chat/route";
import { POST as imagePost } from "../app/api/ai/image/route";
import { POST as videoPost } from "../app/api/ai/video/route";
import { AI_ERROR_CODES } from "../lib/ai/http";
import { AI_ERROR_MESSAGES } from "../components/ai/ai-errors";
import { AiProviderError } from "../lib/ai/types";

const req = (body: unknown) => ({ json: async () => body, headers: new Headers() }) as any;
const KEY = "idem-key-0001";

beforeEach(() => {
  vi.clearAllMocks();
  m.getOptionalUser.mockResolvedValue({ id: "u1" });
  m.guardMutation.mockResolvedValue(null);
  m.rateLimitAsync.mockResolvedValue({ allowed: true });
  m.getVipAccess.mockResolvedValue({ isVip: true, isOwner: false });
  m.consumeAiCredit.mockResolvedValue({ consumed: true, alreadyApplied: false, amount: 10 });
  m.refundAiCredit.mockResolvedValue({ refunded: true });
  m.recordMediaUsage.mockResolvedValue(undefined);
});

describe("API <-> UI contract", () => {
  it("every error code the API can return has an Arabic message in the UI", () => {
    for (const code of AI_ERROR_CODES) expect(AI_ERROR_MESSAGES[code]).toBeDefined();
  });
});

describe("POST /api/ai/chat", () => {
  it("answers { data: { answer } } - the shape AiHubClient reads", async () => {
    m.executeChat.mockResolvedValue({ answer: "hello", provider: "gemini", model: "m", requestId: "r", latencyMs: 1 });
    const response = await chatPost(req({ prompt: "hi", conversationId: "c1", idempotencyKey: KEY }));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.data.answer).toBe("hello");
  });

  it("answers { error } with the right status for credit/VIP/provider failures", async () => {
    for (const [error, status, code] of [
      [new Error("AI_CREDITS_EXHAUSTED"), 402, "AI_CREDITS_EXHAUSTED"],
      [new Error("AI_VIP_REQUIRED"), 403, "AI_VIP_REQUIRED"],
      [new AiProviderError({ provider: "gemini", code: "TIMEOUT" }), 504, "AI_TIMEOUT"],
      [new AiProviderError({ provider: "gemini", code: "EMPTY_RESPONSE" }), 502, "AI_EMPTY_RESPONSE"],
      [new Error("some internal detail"), 503, "AI_SERVICE_UNAVAILABLE"],
    ] as const) {
      m.executeChat.mockRejectedValue(error);
      const response = await chatPost(req({ prompt: "hi", conversationId: "c1", idempotencyKey: KEY }));
      expect(response.status).toBe(status);
      expect((await response.json()).error).toBe(code);
    }
  });

  it("refuses an empty answer from the gateway instead of sending { data: { answer: '' } }", async () => {
    m.executeChat.mockResolvedValue({ answer: "  " });
    const response = await chatPost(req({ prompt: "hi", conversationId: "c1", idempotencyKey: KEY }));
    expect(response.status).toBe(503);
  });

  it("requires login and valid input", async () => {
    m.getOptionalUser.mockResolvedValue(null);
    expect((await chatPost(req({ prompt: "hi", conversationId: "c1" }))).status).toBe(401);
    m.getOptionalUser.mockResolvedValue({ id: "u1" });
    expect((await chatPost(req({ prompt: "", conversationId: "c1" }))).status).toBe(400);
    expect((await chatPost(req({ prompt: "hi", conversationId: "c1", idempotencyKey: "bad key!" }))).status).toBe(400);
    expect(m.executeChat).not.toHaveBeenCalled();
  });

  it("applies the per-user rate limit", async () => {
    m.rateLimitAsync.mockResolvedValue({ allowed: false, retryAfter: 7 });
    const response = await chatPost(req({ prompt: "hi", conversationId: "c1", idempotencyKey: KEY }));
    expect(response.status).toBe(429);
    expect(m.executeChat).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/image", () => {
  it("is disabled and directs users to the wallpaper library", async () => {
    const response = await imagePost(req({ prompt: "a cat", idempotencyKey: KEY }));
    expect(response.status).toBe(410);
    expect((await response.json()).error).toBe("AI_IMAGE_DISABLED");
    expect(m.generateImage).not.toHaveBeenCalled();
    expect(m.consumeAiCredit).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/video", () => {
  const body = { prompt: "a cat running", idempotencyKey: KEY };

  it("answers { data: { status, token } } - the shape AiMediaClient polls with", async () => {
    process.env.AUTH_SECRET = "x".repeat(40);
    m.startVideo.mockResolvedValue({ interactionId: "models/veo/operations/abc", model: "veo" });
    const response = await videoPost(req(body));
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.data.status).toBe("processing");
    expect(typeof json.data.token).toBe("string");
    // the credit reservation is keyed by the client's idempotency key, not a fresh id
    expect(m.consumeAiCredit.mock.calls[0][2]).toBe(KEY);
  });

  it("refunds when the provider refuses to start the video", async () => {
    m.startVideo.mockRejectedValue(new AiProviderError({ provider: "gemini", code: "UNAVAILABLE" }));
    const response = await videoPost(req(body));
    expect(response.status).toBe(503);
    expect(m.refundAiCredit).toHaveBeenCalledTimes(1);
  });

  it("refuses a replayed key instead of starting (and charging for) a second video", async () => {
    m.consumeAiCredit.mockResolvedValue({ consumed: true, alreadyApplied: true, amount: 50 });
    const response = await videoPost(req(body));
    expect(response.status).toBe(409);
    expect(m.startVideo).not.toHaveBeenCalled();
  });

  it("rejects unsupported resolution / aspect ratio before charging", async () => {
    expect((await videoPost(req({ ...body, resolution: "4k" }))).status).toBe(400);
    expect((await videoPost(req({ ...body, aspectRatio: "21:9" }))).status).toBe(400);
    expect(m.consumeAiCredit).not.toHaveBeenCalled();
  });
});
