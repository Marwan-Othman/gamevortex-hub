/**
 * Phase 19 - Games & Apps
 *
 * Public catalogue (/api/games, /api/apps), details, reviews, the download redirects and the
 * API-key protected public API (/api/v1/games).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const db: any = {
    game: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
    app: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), update: vi.fn() },
    review: { findUnique: vi.fn(), upsert: vi.fn(), aggregate: vi.fn() },
    auditLog: { create: vi.fn() },
    gameVortexApiKey: { findUnique: vi.fn(), updateMany: vi.fn() },
    gameVortexApiRequestLog: { create: vi.fn() },
    apiAccessPurchase: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  };
  return { db, requireUser: vi.fn(), awardActionXp: vi.fn(), createActivity: vi.fn() };
});

vi.mock("@/lib/prisma", () => ({ db: h.db, prisma: h.db }));
vi.mock("@/lib/auth", () => ({ requireUser: h.requireUser }));
vi.mock("@/lib/gamer", () => ({ awardActionXp: h.awardActionXp, createActivity: h.createActivity }));

import { GET as gamesGet } from "@/app/api/games/route";
import { GET as gameGet } from "@/app/api/games/[slug]/route";
import { GET as reviewGet, POST as reviewPost } from "@/app/api/games/[slug]/reviews/route";
import { GET as appsGet } from "@/app/api/apps/route";
import { GET as appGet } from "@/app/api/apps/[slug]/route";
import { GET as gameDownload } from "@/app/download/game/[slug]/route";
import { GET as appDownload } from "@/app/download/app/[slug]/route";
import { GET as v1Games } from "@/app/api/v1/games/route";
import { createApiKey } from "@/lib/gamevortex-api/keys";
import { dbDownError, makeRequest, nextIp, routeParams } from "./helpers/phase19";

const FILE_URL = "https://files.example.com/games/setup.zip";
const game = (over: Record<string, unknown> = {}) => ({
  id: "g1",
  slug: "space-run",
  titleAr: "سباق",
  titleEn: "Space Run",
  published: true,
  sourceStatus: "OFFICIAL_SOURCE",
  downloadSource: FILE_URL,
  ratingAverage: 4,
  ratingCount: 10,
  viewCount: 5,
  playCount: 1,
  ...over,
});
const app = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  slug: "tool-app",
  nameAr: "أداة",
  nameEn: "Tool",
  published: true,
  sourceStatus: "OFFICIAL_SOURCE",
  downloadSource: FILE_URL,
  ...over,
});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.clearAllMocks();
  for (const group of Object.values(h.db) as any[]) {
    if (typeof group === "function") continue;
    for (const fn of Object.values(group) as any[]) fn.mockReset();
  }
  h.db.$transaction.mockReset();
  h.requireUser.mockReset();
  h.requireUser.mockResolvedValue({ id: "reviewer_1" });
  h.awardActionXp.mockResolvedValue(undefined);
  h.createActivity.mockResolvedValue(undefined);
  h.db.game.update.mockResolvedValue({});
  h.db.app.update.mockResolvedValue({});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/* ================================================================== */
describe("GET /api/games", () => {
  const list = (query = "", ip?: string) => gamesGet(makeRequest(`/api/games${query}`, { ip }));
  const findManyArgs = () => h.db.game.findMany.mock.calls[0][0];

  beforeEach(() => {
    h.db.game.findMany.mockResolvedValue([game()]);
    h.db.game.count.mockResolvedValue(1);
  });

  it("success: returns published games with pagination, and never the raw download URL", async () => {
    const response = await list();
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.pagination).toEqual({ page: 1, limit: 24, total: 1, sort: "newest", pages: 1 });
    expect(json.data[0].hasDownload).toBe(true);
    expect(JSON.stringify(json)).not.toContain(FILE_URL);
    expect(findManyArgs().where.published).toBe(true);
  });

  it("empty data: no games -> 200 with an empty list and 0 pages", async () => {
    h.db.game.findMany.mockResolvedValue([]);
    h.db.game.count.mockResolvedValue(0);
    const json = await (await list()).json();
    expect(json.data).toEqual([]);
    expect(json.pagination.pages).toBe(0);
  });

  it("invalid data: junk page/limit/sort values fall back to safe defaults instead of failing", async () => {
    for (const query of ["?page=abc&limit=xyz&sort=drop%20table", "?page=-5&limit=0", "?page=NaN&limit=Infinity", "?limit=1000"]) {
      h.db.game.findMany.mockClear();
      const response = await list(query);
      expect(response.status).toBe(200);
      const args = findManyArgs();
      expect(args.skip).toBe(0);
      expect(args.take).toBe(24);
    }
  });

  it("invalid data: the page number is capped so skip cannot overflow the database", async () => {
    await list("?page=999999999999&limit=100");
    expect(findManyArgs().skip).toBe(99_999 * 100);
  });

  it("invalid data: search and category are length capped and an unknown platform is ignored", async () => {
    await list(`?search=${"x".repeat(500)}&category=${"c".repeat(500)}&platform=not-a-platform`);
    const where = findManyArgs().where;
    expect(where.OR[0].titleAr.contains.length).toBe(100);
    expect(where.gamePlatforms).toBeUndefined();
  });

  it("success: a known sort is honoured", async () => {
    await list("?sort=rating");
    expect(findManyArgs().orderBy[0]).toEqual({ featured: "desc" });
  });

  it("database failure: a failing query is a JSON 500 with a fixed message, no internals", async () => {
    h.db.game.findMany.mockRejectedValue(new Error('relation "Game" does not exist'));
    const response = await list();
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain("relation");
    expect(JSON.parse(text).success).toBe(false);
  });

  it("failure: the 121st request in a minute from one IP is rate limited", async () => {
    const ip = nextIp();
    let last: Response | undefined;
    for (let i = 0; i < 121; i += 1) last = await list("", ip);
    expect(last?.status).toBe(429);
  });
});

/* ================================================================== */
describe("GET /api/games/[slug]", () => {
  const detail = (slug = "space-run") => gameGet(makeRequest(`/api/games/${slug}`), routeParams({ slug }));

  beforeEach(() => {
    h.db.game.findFirst.mockResolvedValue({ ...game(), reviews: [] });
    h.db.game.update.mockResolvedValue({});
  });

  it("success: returns the game with hasDownload, hides the file URL, counts the view", async () => {
    const response = await detail();
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.slug).toBe("space-run");
    expect(json.hasDownload).toBe(true);
    expect(JSON.stringify(json)).not.toContain(FILE_URL);
    expect(h.db.game.update).toHaveBeenCalledWith({ where: { id: "g1" }, data: { viewCount: { increment: 1 } } });
    expect(h.db.game.findFirst.mock.calls[0][0].where).toEqual({ slug: "space-run", published: true });
  });

  it("failure: unpublished or unknown game -> 404 GAME_NOT_FOUND and no view is counted", async () => {
    h.db.game.findFirst.mockResolvedValue(null);
    const response = await detail("ghost");
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("GAME_NOT_FOUND");
    expect(h.db.game.update).not.toHaveBeenCalled();
  });

  it("invalid data: an oversized slug is 404 without touching the database", async () => {
    const response = await detail("a".repeat(161));
    expect(response.status).toBe(404);
    expect(h.db.game.findFirst).not.toHaveBeenCalled();
  });

  it("failure: a failing view counter never breaks the page", async () => {
    h.db.game.update.mockRejectedValue(dbDownError());
    expect((await detail()).status).toBe(200);
  });

  it("database failure: 500 GAME_LOAD_FAILED without internals", async () => {
    h.db.game.findFirst.mockRejectedValue(new Error("connection reset by peer"));
    const response = await detail();
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).toContain("GAME_LOAD_FAILED");
    expect(text).not.toContain("connection reset");
  });
});

/* ================================================================== */
describe("Game reviews", () => {
  const params = routeParams({ slug: "space-run" });
  const submit = (body: unknown) => reviewPost(makeRequest("/api/games/space-run/reviews", { body }), params);
  const load = () => reviewGet(makeRequest("/api/games/space-run/reviews"), params);

  beforeEach(() => {
    h.db.game.findFirst.mockResolvedValue({ id: "g1", titleEn: "Space Run" });
    h.db.review.findUnique.mockResolvedValue(null);
    h.db.$transaction.mockImplementation(async (work: any) => work(h.db));
    h.db.review.upsert.mockResolvedValue({ id: "r1", rating: 5 });
    h.db.review.aggregate.mockResolvedValue({ _avg: { rating: 4.5 }, _count: { _all: 2 } });
    h.db.game.update.mockResolvedValue({});
    h.db.auditLog.create.mockResolvedValue({});
  });

  it("success: a first review is 201, updates the game's average and rewards XP once", async () => {
    const response = await submit({ rating: 5, text: "  great  " });
    expect(response.status).toBe(201);
    expect(h.db.review.upsert.mock.calls[0][0].create).toMatchObject({ userId: "reviewer_1", gameId: "g1", rating: 5, text: "great" });
    expect(h.db.game.update).toHaveBeenCalledWith({ where: { id: "g1" }, data: { ratingAverage: 4.5, ratingCount: 2 } });
    expect(h.awardActionXp).toHaveBeenCalledTimes(1);
  });

  it("duplicate request: editing an existing review is 200 and gives no second XP reward", async () => {
    h.db.review.findUnique.mockResolvedValue({ id: "r1" });
    const response = await submit({ rating: 3 });
    expect(response.status).toBe(200);
    expect(h.awardActionXp).not.toHaveBeenCalled();
    expect(h.createActivity).not.toHaveBeenCalled();
  });

  it("unauthorized: not signed in -> 401 for both reading and writing a review", async () => {
    h.requireUser.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await submit({ rating: 5 })).status).toBe(401);
    expect((await load()).status).toBe(401);
    expect(h.db.review.upsert).not.toHaveBeenCalled();
  });

  it("empty data: no rating -> 400 INVALID_REVIEW naming the field", async () => {
    const response = await submit({});
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.error).toBe("INVALID_REVIEW");
    expect(json.fields).toContain("rating");
  });

  it("invalid data: ratings outside 1..5, fractional, text ratings and oversized text are refused", async () => {
    for (const body of [{ rating: 0 }, { rating: 6 }, { rating: 3.5 }, { rating: "5" }, { rating: -1 }, { rating: 5, text: "x".repeat(2001) }]) {
      expect((await submit(body)).status).toBe(400);
    }
    expect(h.db.review.upsert).not.toHaveBeenCalled();
  });

  it("invalid data: malformed JSON -> 400 INVALID_BODY", async () => {
    const response = await reviewPost(makeRequest("/api/games/space-run/reviews", { rawBody: "{oops" }), params);
    expect(response.status).toBe(400);
  });

  it("failure: reviewing a game that does not exist or is unpublished -> 404", async () => {
    h.db.game.findFirst.mockResolvedValue(null);
    const response = await submit({ rating: 4 });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("GAME_NOT_FOUND");
  });

  it("forbidden: a cross-site Origin is refused", async () => {
    vi.stubEnv("APP_ORIGIN", "https://gamevortex.example");
    const response = await reviewPost(makeRequest("/api/games/space-run/reviews", { body: { rating: 5 }, headers: { origin: "https://evil.example" } }), params);
    expect(response.status).toBe(403);
    expect(h.db.review.upsert).not.toHaveBeenCalled();
  });

  it("empty data: GET with no review yet returns null", async () => {
    h.db.review.findUnique.mockResolvedValue(null);
    const response = await load();
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("database failure: outage -> 503; the aggregate failing rolls the whole review back (500, no XP)", async () => {
    h.db.game.findFirst.mockRejectedValueOnce(dbDownError());
    expect((await submit({ rating: 5 })).status).toBe(503);

    h.db.$transaction.mockRejectedValueOnce(new Error("aggregate failed"));
    const response = await submit({ rating: 5 });
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("REVIEW_FAILED");
    expect(h.awardActionXp).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
describe("GET /api/apps", () => {
  const list = (query = "") => appsGet(makeRequest(`/api/apps${query}`));

  beforeEach(() => {
    h.db.app.findMany.mockResolvedValue([app()]);
    h.db.app.count.mockResolvedValue(1);
  });

  it("success: published apps only, raw file URL hidden", async () => {
    const response = await list();
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(h.db.app.findMany.mock.calls[0][0].where.published).toBe(true);
    expect(json.data[0].hasDownload).toBe(true);
    expect(JSON.stringify(json)).not.toContain(FILE_URL);
  });

  it("empty data: no apps -> 200 and an empty list", async () => {
    h.db.app.findMany.mockResolvedValue([]);
    h.db.app.count.mockResolvedValue(0);
    const json = await (await list()).json();
    expect(json.data).toEqual([]);
    expect(json.pagination.total).toBe(0);
  });

  it("invalid data: junk paging is clamped (limit max 60, page min 1) and never fails", async () => {
    await list("?page=abc&limit=99999");
    const args = h.db.app.findMany.mock.calls[0][0];
    expect(args.skip).toBe(0);
    expect(args.take).toBe(60);
    h.db.app.findMany.mockClear();
    await list("?page=-3&limit=-9&sort=nope");
    expect(h.db.app.findMany.mock.calls[0][0].skip).toBe(0);
    expect(h.db.app.findMany.mock.calls[0][0].take).toBeGreaterThan(0);
  });

  it("invalid data: search is trimmed and capped at 80 characters", async () => {
    await list(`?search=${encodeURIComponent("  " + "y".repeat(300))}`);
    expect(h.db.app.findMany.mock.calls[0][0].where.OR[0].nameAr.contains.length).toBe(80);
  });

  it("database failure: retryable JSON 503 with a fixed message and no internals", async () => {
    h.db.app.findMany.mockRejectedValue(new Error("password authentication failed for user admin"));
    const response = await list();
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(text).toContain("APP_CATALOG_UNAVAILABLE");
    expect(text).not.toContain("password authentication");
  });
});

describe("GET /api/apps/[slug]", () => {
  const detail = (slug = "tool-app") => appGet(makeRequest(`/api/apps/${slug}`), routeParams({ slug }));

  it("success: returns the app, hides the file URL and counts the view", async () => {
    h.db.app.findFirst.mockResolvedValue(app());
    const response = await detail();
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain(FILE_URL);
    expect(h.db.app.update).toHaveBeenCalledWith({ where: { id: "a1" }, data: { viewCount: { increment: 1 } } });
  });

  it("failure: unknown or unpublished app -> 404; oversized slug -> 404 without a query", async () => {
    h.db.app.findFirst.mockResolvedValue(null);
    expect((await detail("ghost")).status).toBe(404);
    h.db.app.findFirst.mockClear();
    expect((await detail("a".repeat(161))).status).toBe(404);
    expect(h.db.app.findFirst).not.toHaveBeenCalled();
  });

  it("failure: a failing view counter never breaks the page", async () => {
    h.db.app.findFirst.mockResolvedValue(app());
    h.db.app.update.mockRejectedValue(dbDownError());
    expect((await detail()).status).toBe(200);
  });

  it("database failure: JSON 500", async () => {
    h.db.app.findFirst.mockRejectedValue(dbDownError());
    const response = await detail();
    expect(response.status).toBe(500);
    expect((await response.json()).success).toBe(false);
  });
});

/* ================================================================== */
describe.each([
  ["game", gameDownload, () => h.db.game],
  ["app", appDownload, () => h.db.app],
] as const)("GET /download/%s/[slug]", (kind, handler, table) => {
  const download = (method = "GET", slug = "thing") =>
    handler(makeRequest(`/download/${kind}/${slug}`, { method }), routeParams({ slug }));
  const row = (over: Record<string, unknown> = {}) => ({ id: "x1", downloadSource: FILE_URL, sourceStatus: "OFFICIAL_SOURCE", ...over });

  it("success: counts the download and redirects (303, uncacheable) straight to the file host", async () => {
    table().findFirst.mockResolvedValue(row());
    const response = await download();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(FILE_URL);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(table().update).toHaveBeenCalledWith({ where: { id: "x1" }, data: { downloadCount: { increment: 1 } } });
  });

  it("success: a HEAD request (link preview) redirects but is not counted", async () => {
    table().findFirst.mockResolvedValue(row());
    const response = await download("HEAD");
    expect(response.status).toBe(303);
    expect(table().update).not.toHaveBeenCalled();
  });

  it("failure: unknown item, no source, or an unsafe source (javascript:, http:, localhost, file:) -> 404 and no redirect", async () => {
    table().findFirst.mockResolvedValue(null);
    expect((await download()).status).toBe(404);
    for (const downloadSource of [null, "", "javascript:alert(1)", "http://files.example.com/a.zip", "https://localhost/a.zip", "file:///etc/passwd", "https://user:pw@files.example.com/a.zip"]) {
      table().findFirst.mockResolvedValue(row({ downloadSource }));
      const response = await download();
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
    }
    expect(table().update).not.toHaveBeenCalled();
  });

  it("forbidden: a source whose licence status does not allow distribution -> 403 and no redirect", async () => {
    table().findFirst.mockResolvedValue(row({ sourceStatus: "UNVERIFIED" }));
    const response = await download();
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("DOWNLOAD_SOURCE_NOT_DISTRIBUTABLE");
    expect(response.headers.get("location")).toBeNull();
  });

  it("failure: a failing download counter never blocks the download", async () => {
    table().findFirst.mockResolvedValue(row());
    table().update.mockRejectedValue(dbDownError());
    expect((await download()).status).toBe(303);
  });

  it("database failure: outage -> 503 + Retry-After", async () => {
    table().findFirst.mockRejectedValue(dbDownError());
    const response = await download();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("failure: the 61st download request in a minute from one IP is rate limited", async () => {
    table().findFirst.mockResolvedValue(row());
    const ip = nextIp();
    let last: Response | undefined;
    for (let i = 0; i < 61; i += 1) last = await handler(makeRequest(`/download/${kind}/thing`, { ip }), routeParams({ slug: "thing" }));
    expect(last?.status).toBe(429);
  });
});

/* ================================================================== */
describe("GET /api/v1/games (API key)", () => {
  const { key, secretHash } = createApiKey();
  const call = (token: string | null, query = "", ip?: string) =>
    v1Games(makeRequest(`/api/v1/games${query}`, { headers: token === null ? {} : { authorization: `Bearer ${token}` }, ip }));
  const validKey = (over: Record<string, unknown> = {}) => ({ id: "key_1", userId: "owner_user", revokedAt: null, requiresPurchase: false, ...over });

  beforeEach(() => {
    h.db.gameVortexApiKey.findUnique.mockResolvedValue(validKey());
    h.db.gameVortexApiKey.updateMany.mockResolvedValue({ count: 1 });
    h.db.game.findMany.mockResolvedValue([{ id: "g1" }]);
    h.db.game.count.mockResolvedValue(1);
    h.db.gameVortexApiRequestLog.create.mockResolvedValue({});
    h.db.apiAccessPurchase.findFirst.mockResolvedValue({ id: "purchase_1" });
  });

  it("success: a valid key gets published games, is looked up by HASH, and the request is logged", async () => {
    const response = await call(key);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toHaveLength(1);
    expect(h.db.gameVortexApiKey.findUnique.mock.calls[0][0].where).toEqual({ secretHash });
    expect(JSON.stringify(h.db.gameVortexApiKey.findUnique.mock.calls[0][0])).not.toContain(key);
    expect(h.db.gameVortexApiRequestLog.create).toHaveBeenCalledWith({ data: { apiKeyId: "key_1", route: "/api/v1/games", status: 200 } });
  });

  it("unauthorized: no header, wrong scheme, malformed or unknown keys -> 401 and no database lookup for malformed ones", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call("not-a-key")).status).toBe(401);
    expect((await call("gvh_live_" + "a".repeat(10))).status).toBe(401);
    const basic = await v1Games(makeRequest("/api/v1/games", { headers: { authorization: `Basic ${key}` } }));
    expect(basic.status).toBe(401);
    expect(h.db.gameVortexApiKey.findUnique).not.toHaveBeenCalled();

    h.db.gameVortexApiKey.findUnique.mockResolvedValue(null);
    expect((await call(key)).status).toBe(401);
  });

  it("unauthorized: a revoked key -> 401", async () => {
    h.db.gameVortexApiKey.findUnique.mockResolvedValue(validKey({ revokedAt: new Date() }));
    expect((await call(key)).status).toBe(401);
    expect(h.db.game.findMany).not.toHaveBeenCalled();
  });

  it("unauthorized: a key revoked between lookup and use (race) -> 401", async () => {
    h.db.gameVortexApiKey.updateMany.mockResolvedValue({ count: 0 });
    expect((await call(key)).status).toBe(401);
    expect(h.db.game.findMany).not.toHaveBeenCalled();
  });

  it("forbidden: a key that requires a paid access purchase -> 403 until one has SUCCEEDED", async () => {
    h.db.gameVortexApiKey.findUnique.mockResolvedValue(validKey({ requiresPurchase: true }));
    h.db.apiAccessPurchase.findFirst.mockResolvedValue(null);
    const response = await call(key);
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("API_ACCESS_REQUIRED");
    h.db.apiAccessPurchase.findFirst.mockResolvedValue({ id: "p" });
    expect((await call(key)).status).toBe(200);
  });

  it("invalid data: junk paging is clamped (limit max 50) and search is capped", async () => {
    await call(key, `?page=abc&limit=9999&search=${"s".repeat(500)}`);
    const args = h.db.game.findMany.mock.calls[0][0];
    expect(args.skip).toBe(0);
    expect(args.take).toBe(50);
    expect(args.where.OR[0].titleAr.contains.length).toBe(100);
  });

  it("empty data: no games -> 200 with an empty list", async () => {
    h.db.game.findMany.mockResolvedValue([]);
    h.db.game.count.mockResolvedValue(0);
    const json = await (await call(key)).json();
    expect(json.data).toEqual([]);
  });

  it("failure: guessing keys is throttled per IP (31st bad key in a minute -> 429)", async () => {
    const ip = nextIp();
    let last: Response | undefined;
    for (let i = 0; i < 31; i += 1) last = await call("bad-key", "", ip);
    expect(last?.status).toBe(429);
    expect(Number(last?.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("database failure: a failing key lookup, purchase lookup, usage update or catalogue query -> JSON 500, never an uncaught throw", async () => {
    h.db.gameVortexApiKey.findUnique.mockRejectedValueOnce(dbDownError());
    expect((await call(key)).status).toBe(500);

    h.db.gameVortexApiKey.findUnique.mockResolvedValue(validKey({ requiresPurchase: true }));
    h.db.apiAccessPurchase.findFirst.mockRejectedValueOnce(dbDownError());
    expect((await call(key)).status).toBe(500);

    h.db.gameVortexApiKey.findUnique.mockResolvedValue(validKey());
    h.db.gameVortexApiKey.updateMany.mockRejectedValueOnce(dbDownError());
    expect((await call(key)).status).toBe(500);

    h.db.gameVortexApiKey.updateMany.mockResolvedValue({ count: 1 });
    h.db.game.findMany.mockRejectedValueOnce(dbDownError());
    const response = await call(key);
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("API_REQUEST_FAILED");
    expect(h.db.gameVortexApiRequestLog.create).toHaveBeenCalledWith({ data: { apiKeyId: "key_1", route: "/api/v1/games", status: 500 } });
  });
});
