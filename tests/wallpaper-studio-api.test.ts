/**
 * Wallpaper Studio - API: VIP enforcement on the server, design ownership, save limits, library locking.
 *
 * The real lib/vip.ts (getVipAccess) and the real route handlers run against a small in-memory database
 * that EVALUATES the where-clauses the code sends (status ACTIVE + expiresAt null/future; id + userId),
 * so an expired subscription or someone else's design is rejected because the query is right.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state: any = { users: new Map(), subs: [], wallpapers: new Map(), designs: new Map(), current: null as any, seq: 0 };
  const matchesSub = (sub: any, where: any) => {
    if (sub.userId !== where.userId || sub.status !== where.status) return false;
    return (where.OR as any[]).some((c) => (c.expiresAt === null ? sub.expiresAt === null : c.expiresAt?.gt ? sub.expiresAt !== null && sub.expiresAt > c.expiresAt.gt : false));
  };
  const db: any = {
    user: { findUnique: vi.fn(async ({ where }: any) => (state.users.has(where.id) ? { ...state.users.get(where.id) } : null)) },
    vipSubscription: { findFirst: vi.fn(async ({ where }: any) => state.subs.find((s: any) => matchesSub(s, where)) ?? null) },
    wallpaper: {
      findUnique: vi.fn(async ({ where }: any) => (state.wallpapers.has(where.id) ? { ...state.wallpapers.get(where.id) } : null)),
      findMany: vi.fn(async () => [...state.wallpapers.values()].map((w: any) => ({ ...w }))),
    },
    wallpaperDesign: {
      count: vi.fn(async ({ where }: any) => [...state.designs.values()].filter((d: any) => d.userId === where.userId).length),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `d${++state.seq}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        state.designs.set(row.id, row);
        return { ...row };
      }),
      findMany: vi.fn(async ({ where }: any) => [...state.designs.values()].filter((d: any) => d.userId === where.userId).map((d: any) => ({ ...d }))),
      findFirst: vi.fn(async ({ where }: any) => {
        const row = state.designs.get(where.id);
        return row && row.userId === where.userId ? { ...row } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = state.designs.get(where.id);
        if (!row || row.userId !== where.userId) return { count: 0 };
        state.designs.set(row.id, { ...row, ...data, updatedAt: new Date() });
        return { count: 1 };
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const row = state.designs.get(where.id);
        if (!row || row.userId !== where.userId) return { count: 0 };
        state.designs.delete(row.id);
        return { count: 1 };
      }),
    },
  };
  return { state, db };
});

vi.mock("@/lib/prisma", () => ({ db: h.db, prisma: h.db }));
vi.mock("@/lib/auth", () => ({ getOptionalUser: vi.fn(async () => h.state.current), requireUser: vi.fn(async () => h.state.current) }));

import { GET as listGet, POST as createPost } from "@/app/api/wallpapers/studio/designs/route";
import { DELETE as designDelete, GET as designGet, PUT as designPut } from "@/app/api/wallpapers/studio/designs/[id]/route";
import { GET as libraryGet } from "@/app/api/wallpapers/studio/library/route";
import { STUDIO_SAVE_LIMITS } from "@/lib/wallpaper-studio-policy";
import { buildTemplateDocument, makeLayer } from "@/app/wallpapers/studio/studio-templates";
import { makeRequest, routeParams } from "./helpers/phase19";

const DAY = 86_400_000;
const as = (id: string | null) => {
  h.state.current = id ? { id, role: h.state.users.get(id).role } : null;
};
const freeDoc = () => buildTemplateDocument("cyber", "P");
const vipDoc = () => buildTemplateDocument("royal", "P");
const payload = (document: unknown = freeDoc(), background: unknown = { kind: "none" }, name = "Design") => ({ name, background, document });
const create = (body: unknown) => createPost(makeRequest("/api/wallpapers/studio/designs", { body }));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  h.state.users = new Map([
    ["free", { id: "free", role: "USER" }],
    ["free2", { id: "free2", role: "USER" }],
    ["vip", { id: "vip", role: "USER" }],
    ["expired", { id: "expired", role: "USER" }],
    ["owner", { id: "owner", role: "SUPER_ADMIN" }],
  ]);
  h.state.subs = [
    { id: "s1", userId: "vip", status: "ACTIVE", expiresAt: new Date(Date.now() + 10 * DAY), startedAt: new Date(), plan: { code: "VIP_1M", pointsMultiplier: 1.25 } },
    { id: "s2", userId: "expired", status: "ACTIVE", expiresAt: new Date(Date.now() - DAY), startedAt: new Date(Date.now() - 40 * DAY), plan: { code: "VIP_1M", pointsMultiplier: 1.25 } },
  ];
  h.state.wallpapers = new Map([
    ["w_free", { id: "w_free", published: true, moderationStatus: "APPROVED", mediaType: "IMAGE", isVip: false, titleAr: "حر", titleEn: "Free", category: "GAMING" }],
    ["w_vip", { id: "w_vip", published: true, moderationStatus: "APPROVED", mediaType: "IMAGE", isVip: true, titleAr: "", titleEn: "VIP one", category: "NEON" }],
    ["w_pending", { id: "w_pending", published: true, moderationStatus: "PENDING", mediaType: "IMAGE", isVip: false, titleAr: "", titleEn: "P", category: "OTHER" }],
    ["w_draft", { id: "w_draft", published: false, moderationStatus: "APPROVED", mediaType: "IMAGE", isVip: false, titleAr: "", titleEn: "D", category: "OTHER" }],
  ]);
  h.state.designs = new Map();
  h.state.seq = 0;
  as(null);
});

describe("authentication", () => {
  it("anonymous users cannot list, create, read, update or delete saved designs", async () => {
    expect((await listGet(makeRequest("/api/wallpapers/studio/designs"))).status).toBe(401);
    expect((await create(payload())).status).toBe(401);
    const ctx = routeParams({ id: "d1" });
    expect((await designGet(makeRequest("/api/wallpapers/studio/designs/d1"), ctx)).status).toBe(401);
    expect((await designPut(makeRequest("/api/wallpapers/studio/designs/d1", { method: "PUT", body: payload() }), ctx)).status).toBe(401);
    expect((await designDelete(makeRequest("/api/wallpapers/studio/designs/d1", { method: "DELETE" }), ctx)).status).toBe(401);
    expect(h.state.designs.size).toBe(0);
  });
});

describe("free user", () => {
  beforeEach(() => as("free"));

  it("saves a free design with a free library background", async () => {
    const res = await create(payload(freeDoc(), { kind: "library", wallpaperId: "w_free" }));
    expect(res.status).toBe(201);
    const { design } = await res.json();
    expect(design.tier).toBe("FREE");
    expect(design.background).toEqual({ kind: "library", wallpaperId: "w_free" });
    expect(h.state.designs.get(design.id).userId).toBe("free");
  });

  it("keeps a private local image reference without uploading anything", async () => {
    const res = await create(payload(freeDoc(), { kind: "local", localId: "abc123" }));
    expect(res.status).toBe(201);
    const { design } = await res.json();
    expect(design.background).toEqual({ kind: "local", localId: "abc123" });
    expect(h.state.designs.get(design.id).backgroundWallpaperId).toBeNull();
  });

  it.each([
    ["pro template", () => vipDoc()],
    ["VIP effect", () => ({ ...freeDoc(), effect: "grain" })],
    ["VIP font", () => ({ ...freeDoc(), layers: [makeLayer({ kind: "text", text: "a", fontFamily: "mono" })] })],
    ["glow", () => ({ ...freeDoc(), layers: [makeLayer({ kind: "text", text: "a", glow: true })] })],
  ])("is refused with VIP_REQUIRED for a %s, and nothing is stored", async (_n, doc) => {
    const res = await create(payload(doc()));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("VIP_REQUIRED");
    expect(h.state.designs.size).toBe(0);
  });

  it("cannot trick the server with a client-sent isVip flag", async () => {
    const res = await create({ ...payload(vipDoc()), isVip: true, document: { ...vipDoc(), isVip: true } });
    expect(res.status).toBe(403);
  });

  it("cannot save a VIP library wallpaper as a background", async () => {
    const res = await create(payload(freeDoc(), { kind: "library", wallpaperId: "w_vip" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("VIP_REQUIRED");
  });

  it("cannot use unpublished, unapproved or unknown wallpapers", async () => {
    for (const id of ["w_pending", "w_draft", "nope"]) {
      const res = await create(payload(freeDoc(), { kind: "library", wallpaperId: id }));
      expect(res.status, id).toBe(400);
    }
  });

  it("rejects malformed, tampered and oversized payloads", async () => {
    expect((await create({ name: "", background: { kind: "none" }, document: freeDoc() })).status).toBe(400);
    expect((await create(payload({ ...freeDoc(), effect: "hack" }))).status).toBe(400);
    expect((await create(payload({ ...freeDoc(), layers: [{ ...freeDoc().layers[0], color: "url(javascript:1)" }] }))).status).toBe(400);
    const big = { ...freeDoc(), layers: Array.from({ length: 41 }, () => makeLayer({ kind: "text", text: "x".repeat(300) })) };
    expect((await create(payload(big))).status).toBe(400);
    const bad = await createPost(makeRequest("/api/wallpapers/studio/designs", { rawBody: "{not json" }));
    expect(bad.status).toBe(400);
  });

  it("hits the free save limit but can still update an existing design", async () => {
    let lastId = "";
    for (let i = 0; i < STUDIO_SAVE_LIMITS.FREE; i += 1) {
      const res = await create(payload(freeDoc(), { kind: "none" }, `d${i}`));
      expect(res.status).toBe(201);
      lastId = (await res.json()).design.id;
    }
    const over = await create(payload());
    expect(over.status).toBe(409);
    expect((await over.json()).error).toBe("SAVE_LIMIT_REACHED");
    const upd = await designPut(makeRequest(`/api/wallpapers/studio/designs/${lastId}`, { method: "PUT", body: payload(freeDoc(), { kind: "none" }, "renamed") }), routeParams({ id: lastId }));
    expect(upd.status).toBe(200);
    expect(h.state.designs.get(lastId).name).toBe("renamed");
  });

  it("cannot update a design to include VIP features", async () => {
    const id = (await (await create(payload())).json()).design.id;
    const res = await designPut(makeRequest(`/api/wallpapers/studio/designs/${id}`, { method: "PUT", body: payload(vipDoc()) }), routeParams({ id }));
    expect(res.status).toBe(403);
    expect(h.state.designs.get(id).tier).toBe("FREE");
  });
});

describe("VIP states", () => {
  it("active VIP saves pro designs and VIP backgrounds, with a bigger limit", async () => {
    as("vip");
    const res = await create(payload(vipDoc(), { kind: "library", wallpaperId: "w_vip" }));
    expect(res.status).toBe(201);
    expect((await res.json()).design.tier).toBe("VIP");
    for (let i = 0; i < STUDIO_SAVE_LIMITS.FREE + 2; i += 1) expect((await create(payload())).status).toBe(201);
  });

  it("expired VIP is treated as free", async () => {
    as("expired");
    expect((await create(payload(vipDoc()))).status).toBe(403);
    expect((await create(payload(freeDoc(), { kind: "library", wallpaperId: "w_vip" }))).status).toBe(403);
    expect((await create(payload())).status).toBe(201);
  });

  it("owner has every tool and no save limit", async () => {
    as("owner");
    for (let i = 0; i < STUDIO_SAVE_LIMITS.VIP + 3; i += 1) {
      const res = await create(payload(vipDoc(), { kind: "library", wallpaperId: "w_vip" }));
      expect(res.status).toBe(201);
    }
  });

  it("a design saved while VIP can still be opened after the subscription ends (own data stays readable)", async () => {
    as("vip");
    const id = (await (await create(payload(vipDoc()))).json()).design.id;
    h.state.subs[0].expiresAt = new Date(Date.now() - 1000);
    const res = await designGet(makeRequest(`/api/wallpapers/studio/designs/${id}`), routeParams({ id }));
    expect(res.status).toBe(200);
    expect((await res.json()).design.tier).toBe("VIP");
    const resave = await designPut(makeRequest(`/api/wallpapers/studio/designs/${id}`, { method: "PUT", body: payload(vipDoc()) }), routeParams({ id }));
    expect(resave.status).toBe(403);
  });
});

describe("ownership", () => {
  it("another user cannot read, update or delete someone else's design (404, data untouched)", async () => {
    as("free");
    const id = (await (await create(payload(freeDoc(), { kind: "none" }, "mine"))).json()).design.id;
    as("free2");
    const ctx = routeParams({ id });
    expect((await designGet(makeRequest(`/api/wallpapers/studio/designs/${id}`), ctx)).status).toBe(404);
    expect((await designPut(makeRequest(`/api/wallpapers/studio/designs/${id}`, { method: "PUT", body: payload(freeDoc(), { kind: "none" }, "hijacked") }), ctx)).status).toBe(404);
    expect((await designDelete(makeRequest(`/api/wallpapers/studio/designs/${id}`, { method: "DELETE" }), ctx)).status).toBe(404);
    expect(h.state.designs.get(id).name).toBe("mine");
    const list = await (await listGet(makeRequest("/api/wallpapers/studio/designs"))).json();
    expect(list.designs).toEqual([]);
    as("free");
    expect((await designDelete(makeRequest(`/api/wallpapers/studio/designs/${id}`, { method: "DELETE" }), ctx)).status).toBe(200);
    expect(h.state.designs.size).toBe(0);
  });

  it("even the owner account cannot edit other users' designs through these endpoints", async () => {
    as("free");
    const id = (await (await create(payload())).json()).design.id;
    as("owner");
    expect((await designGet(makeRequest(`/api/wallpapers/studio/designs/${id}`), routeParams({ id }))).status).toBe(404);
  });
});

describe("library", () => {
  it("free users see VIP wallpapers as locked cards without any file link", async () => {
    as("free");
    const data = await (await libraryGet(makeRequest("/api/wallpapers/studio/library"))).json();
    const vipItem = data.items.find((i: any) => i.id === "w_vip");
    expect(vipItem).toMatchObject({ isVip: true, locked: true, src: null, thumb: null });
    expect(JSON.stringify(vipItem)).not.toContain("/api/wallpapers/w_vip");
    expect(data.items.find((i: any) => i.id === "w_free")).toMatchObject({ locked: false, src: "/api/wallpapers/w_free/media" });
  });

  it("anonymous users see them locked too; VIP and owner get the links", async () => {
    const anon = await (await libraryGet(makeRequest("/api/wallpapers/studio/library"))).json();
    expect(anon.items.find((i: any) => i.id === "w_vip").locked).toBe(true);
    for (const id of ["vip", "owner"]) {
      as(id);
      const data = await (await libraryGet(makeRequest("/api/wallpapers/studio/library"))).json();
      expect(data.items.find((i: any) => i.id === "w_vip")).toMatchObject({ locked: false, src: "/api/wallpapers/w_vip/media" });
    }
  });

  it("only published + approved image wallpapers are queried; favorites need a login", async () => {
    await libraryGet(makeRequest("/api/wallpapers/studio/library"));
    const where = h.db.wallpaper.findMany.mock.calls.at(-1)[0].where;
    expect(where).toMatchObject({ published: true, moderationStatus: "APPROVED", mediaType: "IMAGE" });
    expect((await libraryGet(makeRequest("/api/wallpapers/studio/library?favorites=1"))).status).toBe(401);
  });
});
