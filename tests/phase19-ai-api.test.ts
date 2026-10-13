/**
 * Phase 19 - AI API (/api/ai/*)
 *
 * Complements tests/ai-routes.test.ts (API <-> UI contract) with the failure matrix:
 * unauthorized, forbidden (not VIP / not owner), empty and invalid data, duplicate and
 * concurrent requests, insufficient credits, provider failure and database failure.
 * The real routes, lib/api.ts, lib/ai/http.ts, lib/ai/validation.ts and the rate limiter run;
 * the user lookup, VIP lookup, credits, providers and usage log are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getOptionalUser: vi.fn(),
  executeChat: vi.fn(),
  consumeAiCredit: vi.fn(),
  refundAiCredit: vi.fn(),
  generateImage: vi.fn(),
  startVideo: vi.fn(),
  getVipAccess: vi.fn(),
  recordMediaUsage: vi.fn(),
  getProviderHealth: vi.fn(),
  db: {
    aiCreditBalance: { findUnique: vi.fn() },
    aiUsageLedger: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ getOptionalUser: m.getOptionalUser }));
vi.mock("@/lib/prisma", () => ({ db: m.db, prisma: m.db }));
vi.mock("@/lib/ai/gateway", () => ({ executeChat: m.executeChat }));
vi.mock("@/lib/ai/credits", () => ({ consumeAiCredit: m.consumeAiCredit, refundAiCredit: m.refundAiCredit }));
vi.mock("@/lib/ai/media", () => ({ generateImage: m.generateImage, startVideo: m.startVideo }));
vi.mock("@/lib/ai/media-usage", () => ({ recordMediaUsage: m.recordMediaUsage }));
vi.mock("@/lib/vip", () => ({ getVipAccess: m.getVipAccess }));
vi.mock("@/lib/ai/provider-manager", () => ({ getProviderHealth: m.getProviderHealth }));

import { POST as chatPost } from "@/app/api/ai/chat/route";
import { POST as imagePost } from "@/app/api/ai/image/route";
import { POST as videoPost } from "@/app/api/ai/video/route";
import { GET as usageGet } from "@/app/api/ai/usage/route";
import { GET as healthGet } from "@/app/api/ai/admin/health/route";
import { AiProviderError } from "@/lib/ai/types";
import { dbDownError, makeRequest, nextIp } from "./helpers/phase19";

// Built at run time so the repository secret scanner (tests/security-audit.test.ts) never sees a literal token.
const FAKE_GOOGLE_KEY = ["AIza", "Sy", "x".repeat(35)].join("");
const FAKE_SECRET = ["sk", "live", "abcdefghijkl"].join("_");
const KEY = "ai-api-key-0000001";
// A fresh user per test: the per-user rate limiter (lib/ai/http.ts guardUser) is real and keyed by user id.
let userSeq = 0;
let USER = { id: "ai_user_0", role: "USER" };
const vipAccess = (over: Record<string, unknown> = {}) => ({ isVip: true, isOwner: false, planCode: "VIP_MONTHLY", expiresAt: null, ...over });
const PNG = "data:image/png;base64," + "A".repeat(32);

const post = (handler: (r: any) => Promise<Response>, path: string, body: unknown, ip?: string) =>
  handler(makeRequest(path, { body, ip }));
const chat = (body: unknown, ip?: string) => post(chatPost, "/api/ai/chat", body, ip);
const image = (body: unknown, ip?: string) => post(imagePost, "/api/ai/image", body, ip);
const video = (body: unknown, ip?: string) => post(videoPost, "/api/ai/video", body, ip);
const providerError = (code: string) => new AiProviderError({ provider: "gemini", code });

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "phase19-ai-secret-0123456789-abcdef-XYZ");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.clearAllMocks();
  for (const fn of [m.getOptionalUser, m.executeChat, m.consumeAiCredit, m.refundAiCredit, m.generateImage, m.startVideo, m.getVipAccess, m.recordMediaUsage, m.getProviderHealth]) {
    fn.mockReset();
  }
  // every call is a new user, so one test may send several requests without tripping the per-user limiter
  m.getOptionalUser.mockImplementation(async () => (USER = { id: `ai_user_${(userSeq += 1)}`, role: "USER" }));
  m.getVipAccess.mockResolvedValue(vipAccess());
  m.consumeAiCredit.mockResolvedValue({ consumed: true, alreadyApplied: false, amount: 10 });
  m.refundAiCredit.mockResolvedValue({ refunded: true });
  m.recordMediaUsage.mockResolvedValue(undefined);
  m.executeChat.mockResolvedValue({ answer: "hello", provider: "gemini", model: "m", requestId: "r", latencyMs: 1 });
  m.generateImage.mockResolvedValue({ data: Buffer.from("png-bytes").toString("base64"), mimeType: "image/png" });
  m.startVideo.mockResolvedValue({ interactionId: "operations/abc", model: "veo" });
  m.getProviderHealth.mockResolvedValue([{ provider: "gemini", status: "ACTIVE" }]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/* ================================================================== */
describe.each([
  ["chat", chat, { prompt: "hi", conversationId: "c1", idempotencyKey: KEY }],
  ["video", video, { prompt: "a cat running", idempotencyKey: KEY }],
] as const)("POST /api/ai/%s: common failure matrix", (_name, call, validBody) => {
  it("unauthorized: not signed in -> 401 and nothing is spent or generated", async () => {
    m.getOptionalUser.mockResolvedValue(null);
    const response = await call(validBody);
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("UNAUTHORIZED");
    expect(m.consumeAiCredit).not.toHaveBeenCalled();
    expect(m.executeChat).not.toHaveBeenCalled();
    expect(m.generateImage).not.toHaveBeenCalled();
    expect(m.startVideo).not.toHaveBeenCalled();
  });

  it("empty data: an empty body or empty prompt -> 400 INVALID_REQUEST", async () => {
    for (const body of [{}, { ...validBody, prompt: "" }, { ...validBody, prompt: "   " }]) {
      const response = await call(body);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("INVALID_REQUEST");
    }
    expect(m.consumeAiCredit).not.toHaveBeenCalled();
  });

  it("invalid data: a non-string prompt or a bad idempotency key -> 400", async () => {
    for (const body of [{ ...validBody, prompt: 12345 }, { ...validBody, prompt: ["a"] }, { ...validBody, idempotencyKey: "bad key with spaces!" }, { ...validBody, idempotencyKey: "short" }]) {
      expect((await call(body)).status).toBe(400);
    }
    expect(m.consumeAiCredit).not.toHaveBeenCalled();
  });

  it("invalid data: malformed JSON -> 400 and no spending", async () => {
    const handler = { chat: chatPost, image: imagePost, video: videoPost }[_name];
    const response = await handler(makeRequest(`/api/ai/${_name}`, { rawBody: "{not json" }));
    expect(response.status).toBe(400);
    expect(m.consumeAiCredit).not.toHaveBeenCalled();
  });

  it("failure: the per-user rate limit answers 429 with Retry-After", async () => {
    // the per-user limiter is shared by every request of this user, so use a user id of its own
    m.getOptionalUser.mockResolvedValue({ id: `rate_user_${_name}`, role: "USER" });
    let last: Response | undefined;
    for (let i = 0; i < 13; i += 1) last = await call(validBody);
    expect(last?.status).toBe(429);
    expect(Number(last?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("forbidden: a cross-site Origin is refused", async () => {
    vi.stubEnv("APP_ORIGIN", "https://gamevortex.example");
    const handler = { chat: chatPost, image: imagePost, video: videoPost }[_name];
    const response = await handler(makeRequest(`/api/ai/${_name}`, { body: validBody, headers: { origin: "https://evil.example" } }));
    expect(response.status).toBe(403);
    expect(m.getOptionalUser).not.toHaveBeenCalled();
  });

  it("database failure: an outage while reading the session answers 503 JSON with a requestId (no uncaught throw)", async () => {
    m.getOptionalUser.mockRejectedValue(dbDownError());
    const response = await call(validBody);
    const json = await response.json();
    expect(response.status).toBe(503);
    expect(json.error).toBe("AI_SERVICE_UNAVAILABLE");
    expect(json.requestId).toBeDefined();
    expect(JSON.stringify(json)).not.toContain("db.internal");
    expect(m.consumeAiCredit).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/image: disabled feature", () => {
  it("returns 410 without provider calls or credit changes", async () => {
    const response = await image({ prompt: "a cat", idempotencyKey: KEY });
    expect(response.status).toBe(410);
    expect((await response.json()).error).toBe("AI_IMAGE_DISABLED");
    expect(m.generateImage).not.toHaveBeenCalled();
    expect(m.consumeAiCredit).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
describe("POST /api/ai/chat", () => {
  it("success: 200 with the answer", async () => {
    const response = await chat({ prompt: "hi", conversationId: "c1", idempotencyKey: KEY });
    expect(response.status).toBe(200);
    expect((await response.json()).data.answer).toBe("hello");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("invalid data: a missing conversationId is refused", async () => {
    expect((await chat({ prompt: "hi", idempotencyKey: KEY })).status).toBe(400);
    expect(m.executeChat).not.toHaveBeenCalled();
  });

  it("forbidden / insufficient credits: the gateway's VIP and credit refusals keep their statuses", async () => {
    m.executeChat.mockRejectedValueOnce(new Error("AI_VIP_REQUIRED"));
    expect((await chat({ prompt: "hi", conversationId: "c1", idempotencyKey: KEY })).status).toBe(403);
    m.executeChat.mockRejectedValueOnce(new Error("AI_CREDITS_EXHAUSTED"));
    expect((await chat({ prompt: "hi", conversationId: "c1", idempotencyKey: KEY })).status).toBe(402);
  });

  it("duplicate / concurrent request: key conflicts and in-flight requests are 409", async () => {
    m.executeChat.mockRejectedValueOnce(new Error("AI_IDEMPOTENCY_KEY_CONFLICT"));
    expect((await chat({ prompt: "hi", conversationId: "c1", idempotencyKey: KEY })).status).toBe(409);
    m.executeChat.mockRejectedValueOnce(new Error("AI_REQUEST_IN_PROGRESS"));
    expect((await chat({ prompt: "hi", conversationId: "c1", idempotencyKey: KEY })).status).toBe(409);
  });

  it("failure: someone else's conversation is 404, not a leak", async () => {
    m.executeChat.mockRejectedValueOnce(new Error("CONVERSATION_NOT_FOUND"));
    const response = await chat({ prompt: "hi", conversationId: "not-mine", idempotencyKey: KEY });
    expect(response.status).toBe(404);
  });

  it("provider failure: timeout 504, empty answer 502, anything else 503 - and the provider's message never reaches the client", async () => {
    const cases: Array<[unknown, number]> = [
      [providerError("TIMEOUT"), 504],
      [providerError("EMPTY_RESPONSE"), 502],
      [providerError("RATE_LIMITED"), 503],
      [new Error(`Gemini 500: key ${FAKE_GOOGLE_KEY} rejected`), 503],
    ];
    for (const [error, status] of cases) {
      m.executeChat.mockRejectedValueOnce(error);
      const response = await chat({ prompt: "hi", conversationId: "c1", idempotencyKey: KEY });
      const text = await response.text();
      expect(response.status).toBe(status);
      expect(text).not.toContain(FAKE_GOOGLE_KEY);
      expect(text).not.toContain("Gemini 500");
    }
  });

  it("provider failure: a blank answer from the provider is never returned as a success", async () => {
    m.executeChat.mockResolvedValueOnce({ answer: "   " });
    expect((await chat({ prompt: "hi", conversationId: "c1", idempotencyKey: KEY })).status).toBe(503);
    m.executeChat.mockResolvedValueOnce(undefined);
    expect((await chat({ prompt: "hi", conversationId: "c1", idempotencyKey: KEY })).status).toBe(503);
  });

  it("database failure: an outage inside the gateway is 503, not 500 or a leak", async () => {
    m.executeChat.mockRejectedValueOnce(dbDownError());
    const response = await chat({ prompt: "hi", conversationId: "c1", idempotencyKey: KEY });
    expect(response.status).toBe(503);
  });
});

/* ================================================================== */
describe("POST /api/ai/video", () => {
  const body = { prompt: "a cat running", idempotencyKey: KEY };

  it("success: starts the job, returns a processing token, and never waits for the video", async () => {
    m.consumeAiCredit.mockResolvedValue({ consumed: true, alreadyApplied: false, amount: 50 });
    const response = await video(body);
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.data.status).toBe("processing");
    expect(m.consumeAiCredit).toHaveBeenCalledWith(USER.id, "VIDEO", KEY, 50);
  });

  it("success: the owner is not charged", async () => {
    m.getVipAccess.mockResolvedValue(vipAccess({ isOwner: true }));
    expect((await video(body)).status).toBe(200);
    expect(m.consumeAiCredit).not.toHaveBeenCalled();
  });

  it("forbidden / expired subscription: not VIP -> 403 before any credit is touched", async () => {
    m.getVipAccess.mockResolvedValue(vipAccess({ isVip: false, planCode: "FREE" }));
    const response = await video(body);
    expect(response.status).toBe(403);
    expect(m.consumeAiCredit).not.toHaveBeenCalled();
    expect(m.startVideo).not.toHaveBeenCalled();
  });

  it("insufficient credits: 402 and the provider is not called", async () => {
    m.consumeAiCredit.mockRejectedValue(new Error("AI_CREDITS_EXHAUSTED"));
    const response = await video(body);
    expect(response.status).toBe(402);
    expect(m.startVideo).not.toHaveBeenCalled();
    expect(m.refundAiCredit).not.toHaveBeenCalled();
  });

  it("invalid data: unsupported resolution or aspect ratio, oversize prompt, bad image -> refused before charging", async () => {
    expect((await video({ ...body, resolution: "4k" })).status).toBe(400);
    expect((await video({ ...body, aspectRatio: "1:1" })).status).toBe(400);
    expect((await video({ ...body, prompt: "x".repeat(4001) })).status).toBe(400);
    expect((await video({ ...body, imageData: "not-an-image" })).status).toBe(400);
    expect(m.consumeAiCredit).not.toHaveBeenCalled();
  });

  it("duplicate request: a replayed key never starts (or charges) a second video", async () => {
    m.consumeAiCredit.mockResolvedValue({ consumed: true, alreadyApplied: true, amount: 50 });
    const response = await video(body);
    expect(response.status).toBe(409);
    expect(m.startVideo).not.toHaveBeenCalled();
    expect(m.refundAiCredit).not.toHaveBeenCalled();
  });

  it("provider failure: refunds the reservation and reports a fixed error code", async () => {
    m.consumeAiCredit.mockResolvedValue({ consumed: true, alreadyApplied: false, amount: 50 });
    m.startVideo.mockRejectedValue(providerError("UNAVAILABLE"));
    const response = await video(body);
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(text).toContain("AI_SERVICE_UNAVAILABLE");
    expect(m.refundAiCredit).toHaveBeenCalledWith(USER.id, "VIDEO", KEY, 50);
  });

  it("database failure: an outage while looking up VIP status answers 503 and spends nothing", async () => {
    m.getVipAccess.mockRejectedValue(dbDownError());
    expect((await video(body)).status).toBe(503);
    expect(m.consumeAiCredit).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
describe("GET /api/ai/usage", () => {
  const usage = () => usageGet(makeRequest("/api/ai/usage"));

  beforeEach(() => {
    m.db.aiCreditBalance.findUnique.mockResolvedValue({ gvcBalance: 80 });
    m.db.aiUsageLedger.findMany.mockResolvedValue([]);
  });

  it("success: the user's balance and recent usage, scoped to that user", async () => {
    const response = await usage();
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json).toMatchObject({ balance: 80, unlimited: false, recent: [] });
    expect(m.db.aiUsageLedger.findMany.mock.calls[0][0].where).toEqual({ userId: USER.id });
  });

  it("empty data: a user without a balance row sees 0, not an error", async () => {
    m.db.aiCreditBalance.findUnique.mockResolvedValue(null);
    expect((await (await usage()).json()).balance).toBe(0);
  });

  it("expired subscription: shows isVip false", async () => {
    m.getVipAccess.mockResolvedValue(vipAccess({ isVip: false, planCode: "FREE" }));
    expect((await (await usage()).json()).vip.isVip).toBe(false);
  });

  it("success: the owner sees an unlimited balance", async () => {
    m.getVipAccess.mockResolvedValue(vipAccess({ isOwner: true }));
    expect(await (await usage()).json()).toMatchObject({ unlimited: true, balance: null });
  });

  it("unauthorized: 401 and no query", async () => {
    m.getOptionalUser.mockResolvedValue(null);
    expect((await usage()).status).toBe(401);
    expect(m.db.aiCreditBalance.findUnique).not.toHaveBeenCalled();
  });

  it("database failure: an outage in the session lookup or the query is 503 JSON", async () => {
    m.getOptionalUser.mockRejectedValueOnce(dbDownError());
    expect((await usage()).status).toBe(503);
    m.db.aiUsageLedger.findMany.mockRejectedValueOnce(dbDownError());
    expect((await usage()).status).toBe(503);
  });
});

/* ================================================================== */
describe("GET /api/ai/admin/health", () => {
  const health = () => healthGet(makeRequest("/api/ai/admin/health"));

  beforeEach(() => {
    m.getOptionalUser.mockResolvedValue({ id: "owner", role: "SUPER_ADMIN" });
    m.db.aiUsageLedger.count.mockResolvedValue(0);
    m.db.aiUsageLedger.groupBy.mockResolvedValue([]);
  });

  it("success: the owner gets the 24h report", async () => {
    const response = await health();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ period: "24h", requests: { total: 0, completed: 0, failed: 0 } });
  });

  it("unauthorized: signed out -> 401", async () => {
    m.getOptionalUser.mockResolvedValue(null);
    expect((await health()).status).toBe(401);
  });

  it("forbidden: a signed-in USER or STAFF -> 403 (not 401) and no report", async () => {
    for (const role of ["USER", "STAFF"]) {
      m.getOptionalUser.mockResolvedValue({ id: "u", role });
      const response = await health();
      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("FORBIDDEN");
    }
    expect(m.getProviderHealth).not.toHaveBeenCalled();
  });

  it("database failure: an outage in the session lookup or the report -> 503 JSON", async () => {
    m.getOptionalUser.mockRejectedValueOnce(dbDownError());
    expect((await health()).status).toBe(503);
    m.db.aiUsageLedger.count.mockRejectedValue(dbDownError());
    expect((await health()).status).toBe(503);
  });

  it("provider failure: a failing health probe is 500 AI_HEALTH_FAILED with no internals", async () => {
    m.getProviderHealth.mockRejectedValue(new Error(`manus api key ${FAKE_SECRET} invalid`));
    const response = await health();
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).toContain("AI_HEALTH_FAILED");
    expect(text).not.toContain(FAKE_SECRET);
  });
});
