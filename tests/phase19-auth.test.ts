/**
 * Phase 19 - Authentication & Authorization
 *
 * Covers: Success, Failure, Unauthorized, Forbidden, Empty data, Invalid data,
 * Duplicate request, Concurrent request, Database failure.
 *
 * The real lib/auth.ts, lib/api.ts and lib/security.ts run unmodified; only the
 * database, the cookie store and the side-effect modules (XP, referrals) are faked.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const jar = new Map<string, string>();
  const users = new Map<string, Record<string, any>>();
  const cookieStore = {
    get: vi.fn((name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined)),
    set: vi.fn((name: string, value: string, _options?: Record<string, unknown>) => {
      jar.set(name, value);
    }),
    delete: vi.fn((name: string) => {
      jar.delete(name);
    }),
  };
  const db = {
    user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    xpEvent: { findFirst: vi.fn() },
  };
  return {
    jar,
    users,
    cookieStore,
    db,
    grantXp: vi.fn(),
    generateUniqueReferralCode: vi.fn(),
    linkReferral: vi.fn(),
  };
});

vi.mock("next/headers", () => ({ cookies: async () => h.cookieStore }));
vi.mock("@/lib/prisma", () => ({ db: h.db, prisma: h.db }));
vi.mock("@/lib/gamer", () => ({ grantXp: h.grantXp }));
vi.mock("@/lib/referrals", () => ({
  generateUniqueReferralCode: h.generateUniqueReferralCode,
  linkReferral: h.linkReferral,
}));

import { Prisma } from "@prisma/client";
import { createSession, getOptionalUser, hashPassword, requireOwner, requireUser, verifyPassword } from "@/lib/auth";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as registerPost } from "@/app/api/auth/register/route";
import { GET as mePost } from "@/app/api/auth/me/route";
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { dbDownError, makeRequest, nextIp } from "./helpers/phase19";

const SECRET = "phase19-test-secret-value-0123456789-abcdef-XYZ";
const PASSWORD = "correct-horse-battery";
const HASH = hashPassword(PASSWORD);
const COOKIE = "gv_session";

let seq = 0;
const uniqueEmail = () => `player${(seq += 1)}@example.com`;

function makeUser(over: Record<string, any> = {}) {
  seq += 1;
  return {
    id: `user_${seq}`,
    email: `user${seq}@example.com`,
    username: `user${seq}`,
    role: "USER",
    points: 25,
    sessionVersion: 1,
    passwordHash: HASH,
    ...over,
  };
}

function seedUser(user: Record<string, any>) {
  h.users.set(user.id, user);
  return user;
}

/** Builds a validly signed session cookie value, exactly like lib/auth.ts does. */
function forgeToken(payload: Record<string, unknown>, secret = SECRET) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;
const oneHourAgo = () => Math.floor(Date.now() / 1000) - 3600;

function signIn(user: Record<string, any>, overrides: Record<string, unknown> = {}) {
  h.jar.set(COOKIE, forgeToken({ sub: user.id, sv: user.sessionVersion, exp: inOneHour(), ...overrides }));
}

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("APP_ORIGIN", "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  h.jar.clear();
  h.users.clear();
  vi.clearAllMocks();

  h.db.user.findUnique.mockImplementation(async ({ where }: { where: Record<string, string> }) => {
    if (where.id) return h.users.get(where.id) ?? null;
    if (where.email) return [...h.users.values()].find((u) => u.email === where.email) ?? null;
    return null;
  });
  h.db.user.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: any }) => {
    const user = h.users.get(where.id);
    if (!user) throw Object.assign(new Error("not found"), { code: "P2025" });
    if (data?.sessionVersion?.increment) user.sessionVersion += data.sessionVersion.increment;
    return { id: user.id };
  });
  h.db.user.findFirst.mockResolvedValue(null);
  h.db.user.create.mockImplementation(async ({ data }: { data: any }) => {
    const created = { id: "new_user_1", email: data.email, username: data.username, role: "USER", points: 0, referralCode: data.referralCode };
    // the row exists afterwards, so createSession() can read its sessionVersion
    h.users.set(created.id, { ...created, sessionVersion: 1 });
    return created;
  });
  h.db.xpEvent.findFirst.mockResolvedValue(null);
  h.grantXp.mockResolvedValue(undefined);
  h.generateUniqueReferralCode.mockResolvedValue("REF123");
  h.linkReferral.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/* ------------------------------------------------------------------ */
describe("Authentication: password hashing", () => {
  it("success: a password verifies against its own hash, and the hash is salted", () => {
    expect(HASH.startsWith("scrypt$")).toBe(true);
    expect(HASH).not.toContain(PASSWORD);
    expect(verifyPassword(PASSWORD, HASH)).toBe(true);
    expect(hashPassword(PASSWORD)).not.toBe(HASH);
  });

  it("failure: a wrong password does not verify", () => {
    expect(verifyPassword("not-the-password", HASH)).toBe(false);
    expect(verifyPassword("", HASH)).toBe(false);
  });

  it("invalid data: a short password is refused", () => {
    expect(() => hashPassword("short")).toThrow("PASSWORD_TOO_SHORT");
    expect(() => hashPassword("")).toThrow("PASSWORD_TOO_SHORT");
  });

  it("invalid data: a malformed stored hash never verifies and never throws", () => {
    for (const bad of ["", "plain", "scrypt$$", "scrypt$salt", "bcrypt$salt$hash", "scrypt$salt$zz-not-hex"]) {
      expect(verifyPassword(PASSWORD, bad)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */
describe("Authentication: session cookie", () => {
  it("success: createSession sets an httpOnly, SameSite=Lax, 7 day cookie that getOptionalUser accepts", async () => {
    const user = seedUser(makeUser());
    await createSession(user.id);

    const [name, value, options] = h.cookieStore.set.mock.calls[0];
    expect(name).toBe(COOKIE);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
    expect(String(value).split(".")).toHaveLength(2);
    // the cookie value never contains the password hash or e-mail
    expect(String(value)).not.toContain("scrypt");

    await expect(getOptionalUser()).resolves.toMatchObject({ id: user.id });
  });

  it("failure: createSession for a user that does not exist refuses and sets nothing", async () => {
    await expect(createSession("ghost")).rejects.toThrow("UNAUTHORIZED");
    expect(h.cookieStore.set).not.toHaveBeenCalled();
  });

  it("failure: a missing or short AUTH_SECRET refuses to sign sessions", async () => {
    const user = seedUser(makeUser());
    vi.stubEnv("AUTH_SECRET", "too-short");
    await expect(createSession(user.id)).rejects.toThrow("AUTH_SECRET_NOT_CONFIGURED");
    vi.stubEnv("AUTH_SECRET", "");
    await expect(createSession(user.id)).rejects.toThrow("AUTH_SECRET_NOT_CONFIGURED");
  });

  it("unauthorized: no cookie means no user, and the database is not queried", async () => {
    await expect(getOptionalUser()).resolves.toBeNull();
    expect(h.db.user.findUnique).not.toHaveBeenCalled();
  });

  it("unauthorized: garbage, truncated and three-part tokens are rejected", async () => {
    for (const bad of ["abc", "a.b.c", ".", "payload.", ".signature", " "]) {
      h.jar.set(COOKIE, bad);
      await expect(getOptionalUser()).resolves.toBeNull();
    }
    expect(h.db.user.findUnique).not.toHaveBeenCalled();
  });

  it("unauthorized: a tampered payload (privilege escalation attempt) is rejected", async () => {
    const victim = seedUser(makeUser());
    const attacker = seedUser(makeUser());
    signIn(attacker);
    const [, signature] = String(h.jar.get(COOKIE)).split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ sub: victim.id, sv: 1, exp: inOneHour() })).toString("base64url");
    h.jar.set(COOKIE, `${forgedPayload}.${signature}`);
    await expect(getOptionalUser()).resolves.toBeNull();
  });

  it("unauthorized: a token signed with another secret is rejected", async () => {
    const user = seedUser(makeUser());
    h.jar.set(COOKIE, forgeToken({ sub: user.id, sv: 1, exp: inOneHour() }, "another-secret-another-secret-another-secret"));
    await expect(getOptionalUser()).resolves.toBeNull();
  });

  it("unauthorized: an expired token is rejected even though its signature is valid", async () => {
    const user = seedUser(makeUser());
    signIn(user, { exp: oneHourAgo() });
    await expect(getOptionalUser()).resolves.toBeNull();
  });

  it("invalid data: a validly signed token with a bad shape is rejected", async () => {
    const user = seedUser(makeUser());
    const shapes: Array<Record<string, unknown>> = [
      { sub: "", sv: 1, exp: inOneHour() },
      { sub: user.id, sv: "1", exp: inOneHour() },
      { sub: user.id, sv: 1.5, exp: inOneHour() },
      { sub: user.id, sv: 1, exp: "soon" },
      { sub: 42, sv: 1, exp: inOneHour() },
      { sv: 1, exp: inOneHour() },
    ];
    for (const shape of shapes) {
      h.jar.set(COOKIE, forgeToken(shape));
      await expect(getOptionalUser()).resolves.toBeNull();
    }
  });

  it("unauthorized: after sessions are revoked (sessionVersion bumped) the old cookie stops working", async () => {
    const user = seedUser(makeUser());
    signIn(user);
    await expect(getOptionalUser()).resolves.toMatchObject({ id: user.id });
    user.sessionVersion += 1;
    await expect(getOptionalUser()).resolves.toBeNull();
  });

  it("unauthorized: a cookie for a deleted account is rejected", async () => {
    const user = seedUser(makeUser());
    signIn(user);
    h.users.delete(user.id);
    await expect(getOptionalUser()).resolves.toBeNull();
  });

  it("database failure: an outage is not disguised as 'logged out'", async () => {
    const user = seedUser(makeUser());
    signIn(user);
    h.db.user.findUnique.mockRejectedValue(dbDownError());
    await expect(getOptionalUser()).rejects.toThrow(/reach database/);
  });
});

/* ------------------------------------------------------------------ */
describe("Authorization: requireUser / requireOwner", () => {
  it("unauthorized: both guards throw UNAUTHORIZED (never FORBIDDEN) for an anonymous caller", async () => {
    await expect(requireUser()).rejects.toThrow("UNAUTHORIZED");
    await expect(requireOwner()).rejects.toThrow("UNAUTHORIZED");
  });

  it("success: a signed-in user passes requireUser", async () => {
    const user = seedUser(makeUser());
    signIn(user);
    await expect(requireUser()).resolves.toMatchObject({ id: user.id });
  });

  it("forbidden: USER and STAFF are not the owner", async () => {
    for (const role of ["USER", "STAFF"]) {
      const user = seedUser(makeUser({ role }));
      signIn(user);
      await expect(requireOwner()).rejects.toThrow("FORBIDDEN");
    }
  });

  it("success: SUPER_ADMIN passes requireOwner", async () => {
    const owner = seedUser(makeUser({ role: "SUPER_ADMIN" }));
    signIn(owner);
    await expect(requireOwner()).resolves.toMatchObject({ id: owner.id, role: "SUPER_ADMIN" });
  });

  it("forbidden: the role is read fresh on every request, so a demoted owner loses access at once", async () => {
    const owner = seedUser(makeUser({ role: "SUPER_ADMIN" }));
    signIn(owner);
    await expect(requireOwner()).resolves.toBeDefined();
    owner.role = "USER";
    await expect(requireOwner()).rejects.toThrow("FORBIDDEN");
  });

  it("forbidden: a role claimed inside the cookie is ignored", async () => {
    const user = seedUser(makeUser({ role: "USER" }));
    signIn(user, { role: "SUPER_ADMIN", isOwner: true });
    await expect(requireOwner()).rejects.toThrow("FORBIDDEN");
  });
});

/* ------------------------------------------------------------------ */
describe("POST /api/auth/login", () => {
  const login = (body: unknown, ip?: string) => loginPost(makeRequest("/api/auth/login", { body, ip }));

  it("success: 200, a session cookie, and only id/username/role in the response", async () => {
    const user = seedUser(makeUser());
    const response = await login({ email: user.email, password: PASSWORD });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ ok: true, user: { id: user.id, username: user.username, role: "USER" } });
    expect(JSON.stringify(json)).not.toContain("passwordHash");
    expect(h.cookieStore.set).toHaveBeenCalledTimes(1);
  });

  it("success: the e-mail is matched case-insensitively and whitespace is trimmed", async () => {
    const user = seedUser(makeUser({ email: "mixed@example.com" }));
    const response = await login({ email: "  MiXeD@Example.COM ", password: PASSWORD });
    expect(response.status).toBe(200);
    expect(h.db.user.findUnique).toHaveBeenCalledWith({ where: { email: "mixed@example.com" } });
    expect(user.id).toBeDefined();
  });

  it("success: the welcome XP is granted once, on the first login only", async () => {
    const user = seedUser(makeUser());
    await login({ email: user.email, password: PASSWORD });
    expect(h.grantXp).toHaveBeenCalledWith(user.id, 50, "FIRST_LOGIN");

    h.grantXp.mockClear();
    h.db.xpEvent.findFirst.mockResolvedValue({ id: "evt" });
    await login({ email: user.email, password: PASSWORD });
    expect(h.grantXp).not.toHaveBeenCalled();
  });

  it("failure: a failing welcome-XP grant never blocks a correct login", async () => {
    const user = seedUser(makeUser());
    h.grantXp.mockRejectedValue(new Error("xp table missing"));
    const response = await login({ email: user.email, password: PASSWORD });
    expect(response.status).toBe(200);
    expect(h.cookieStore.set).toHaveBeenCalled();
  });

  it("unauthorized: wrong password -> 401 INVALID_CREDENTIALS and no cookie", async () => {
    const user = seedUser(makeUser());
    const response = await login({ email: user.email, password: "wrong-password-123" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "INVALID_CREDENTIALS" });
    expect(h.cookieStore.set).not.toHaveBeenCalled();
  });

  it("unauthorized: an unknown e-mail answers exactly like a wrong password (no account enumeration)", async () => {
    const user = seedUser(makeUser());
    const wrongPassword = await login({ email: user.email, password: "wrong-password-123" });
    const unknown = await login({ email: "nobody@example.com", password: "wrong-password-123" });
    expect(unknown.status).toBe(wrongPassword.status);
    expect(await unknown.json()).toEqual(await wrongPassword.json());
  });

  it("unauthorized: an account that only has social login (no password) cannot log in with a password", async () => {
    const user = seedUser(makeUser({ passwordHash: null }));
    const response = await login({ email: user.email, password: PASSWORD });
    expect(response.status).toBe(401);
  });

  it("empty data: no body fields -> 400 INVALID_INPUT, database untouched", async () => {
    for (const body of [{}, { email: "", password: "" }, { email: "a@b.co" }, { password: PASSWORD }]) {
      const response = await login(body);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("INVALID_INPUT");
    }
    expect(h.db.user.findUnique).not.toHaveBeenCalled();
  });

  it("invalid data: bad e-mail, wrong types and oversized values -> 400", async () => {
    const bodies = [
      { email: "not-an-email", password: PASSWORD },
      { email: "a@b.co", password: 12345678 },
      { email: ["a@b.co"], password: PASSWORD },
      { email: "a@b.co", password: "x".repeat(201) },
      { email: `${"a".repeat(320)}@example.com`, password: PASSWORD },
    ];
    for (const body of bodies) expect((await login(body)).status).toBe(400);
    expect(h.db.user.findUnique).not.toHaveBeenCalled();
  });

  it("invalid data: malformed JSON -> 400 INVALID_BODY", async () => {
    const response = await loginPost(makeRequest("/api/auth/login", { rawBody: "{not json" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_BODY");
  });

  it("forbidden: a cross-site Origin is rejected before anything else runs", async () => {
    vi.stubEnv("APP_ORIGIN", "https://gamevortex.example");
    const user = seedUser(makeUser());
    const response = await loginPost(
      makeRequest("/api/auth/login", {
        body: { email: user.email, password: PASSWORD },
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("CSRF_ORIGIN_REJECTED");
    expect(h.db.user.findUnique).not.toHaveBeenCalled();
  });

  it("failure: the 9th attempt from one IP in a minute is rate limited with Retry-After", async () => {
    const ip = nextIp();
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 9; i += 1) {
      last = await login({ email: uniqueEmail(), password: "wrong-password-123" }, ip);
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 8).every((s) => s === 401)).toBe(true);
    expect(statuses[8]).toBe(429);
    expect(Number(last?.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await last?.json()).error).toBe("RATE_LIMITED");
  });

  it("failure: distributed guessing against ONE account is stopped by the per-account limit", async () => {
    const email = uniqueEmail();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await login({ email, password: "wrong-password-123" })).status); // a fresh IP each time
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("concurrent request: simultaneous logins of different users do not interfere", async () => {
    const users = Array.from({ length: 5 }, () => seedUser(makeUser()));
    const responses = await Promise.all(users.map((u) => login({ email: u.email, password: PASSWORD })));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
  });

  it("database failure: an outage answers 503 + Retry-After and leaks nothing", async () => {
    const user = seedUser(makeUser());
    h.db.user.findUnique.mockRejectedValue(dbDownError());
    const response = await login({ email: user.email, password: PASSWORD });
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(text).toContain("SERVICE_UNAVAILABLE");
    expect(text).not.toContain("db.internal");
    expect(h.cookieStore.set).not.toHaveBeenCalled();
  });

  it("database failure: an unexpected error answers 500 LOGIN_FAILED + requestId, never the raw message", async () => {
    const user = seedUser(makeUser());
    h.db.user.findUnique.mockRejectedValue(new Error('relation "User" does not exist'));
    const response = await login({ email: user.email, password: PASSWORD });
    const json = await response.json();
    expect(response.status).toBe(500);
    expect(json.error).toBe("LOGIN_FAILED");
    expect(json.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(json)).not.toContain("relation");
  });
});

/* ------------------------------------------------------------------ */
describe("POST /api/auth/register", () => {
  const valid = () => ({ email: uniqueEmail(), username: `Gamer_${seq}`, password: "a-long-enough-password" });
  const register = (body: unknown, ip?: string) => registerPost(makeRequest("/api/auth/register", { body, ip }));

  it("success: 201, lower-cased identity, hashed password, a wallet, and a session", async () => {
    const body = { ...valid(), email: "New.Player@Example.com", username: "New_Player" };
    const response = await register(body);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.referralApplied).toBe(false);

    const call = h.db.user.create.mock.calls[0][0];
    expect(call.data.email).toBe("new.player@example.com");
    expect(call.data.username).toBe("new_player");
    expect(call.data.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(call.data.passwordHash).not.toContain(body.password);
    expect(call.data.wallet).toEqual({ create: {} });
    expect(call.select.passwordHash).toBeUndefined();
    expect(h.cookieStore.set).toHaveBeenCalled();
  });

  it("success: a valid referral code is reported back", async () => {
    h.linkReferral.mockResolvedValue({ id: "ref1" });
    const response = await register({ ...valid(), referralCode: "FRIEND1" });
    expect((await response.json()).referralApplied).toBe(true);
    expect(h.linkReferral).toHaveBeenCalledWith("new_user_1", "FRIEND1");
  });

  it("duplicate request: an e-mail or username already in use -> 409 and nothing is created", async () => {
    h.db.user.findFirst.mockResolvedValue({ id: "existing" });
    const response = await register(valid());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("ACCOUNT_ALREADY_EXISTS");
    expect(h.db.user.create).not.toHaveBeenCalled();
  });

  it("concurrent request: two identical sign-ups racing past the pre-check -> one 201 and one 409 (unique index)", async () => {
    const body = valid();
    h.users.set("winner", { id: "winner", sessionVersion: 1 });
    h.db.user.create
      .mockResolvedValueOnce({ id: "winner", email: body.email, username: body.username, role: "USER", points: 0, referralCode: "R" })
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }));
    const responses = await Promise.all([register(body), register(body)]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("empty data: {} -> 400 INVALID_INPUT", async () => {
    const response = await register({});
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_INPUT");
    expect(h.db.user.create).not.toHaveBeenCalled();
  });

  it("invalid data: weak password, bad username, bad e-mail -> 400 and nothing is created", async () => {
    const base = valid();
    const bodies = [
      { ...base, password: "123456789" }, // 9 chars
      { ...base, password: "x".repeat(201) },
      { ...base, username: "ab" },
      { ...base, username: "has space" },
      { ...base, username: "emoji_😀" },
      { ...base, username: "a".repeat(33) },
      { ...base, email: "nope" },
      { ...base, referralCode: "r".repeat(41) },
    ];
    for (const body of bodies) expect((await register(body)).status).toBe(400);
    expect(h.db.user.create).not.toHaveBeenCalled();
  });

  it("invalid data: malformed JSON -> 400 INVALID_BODY", async () => {
    const response = await registerPost(makeRequest("/api/auth/register", { rawBody: "{{" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_BODY");
  });

  it("failure: the 6th sign-up from one IP in a minute is rate limited", async () => {
    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await register(valid(), ip)).status);
    expect(statuses.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(statuses[5]).toBe(429);
  });

  it("database failure: outage -> 503; unexpected error -> 500 REGISTER_FAILED without the raw message", async () => {
    h.db.user.findFirst.mockRejectedValueOnce(dbDownError());
    const outage = await register(valid());
    expect(outage.status).toBe(503);

    h.db.user.create.mockRejectedValueOnce(new Error("deadlock detected on table User"));
    const broken = await register(valid());
    const json = await broken.json();
    expect(broken.status).toBe(500);
    expect(json.error).toBe("REGISTER_FAILED");
    expect(JSON.stringify(json)).not.toContain("deadlock");
  });
});

/* ------------------------------------------------------------------ */
describe("GET /api/auth/me", () => {
  const me = () => mePost(makeRequest("/api/auth/me"));

  it("success: returns the public profile fields only, never cached", async () => {
    const user = seedUser(makeUser());
    signIn(user);
    const response = await me();
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(Object.keys(json).sort()).toEqual(["email", "id", "points", "role", "username"]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("unauthorized: no cookie, a tampered cookie and a revoked session are all 401", async () => {
    expect((await me()).status).toBe(401);

    h.jar.set(COOKIE, "tampered.value");
    expect((await me()).status).toBe(401);

    const user = seedUser(makeUser());
    signIn(user);
    user.sessionVersion += 1;
    const response = await me();
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("UNAUTHORIZED");
  });

  it("database failure: an outage is 503, NOT 401, so the UI does not log the user out", async () => {
    const user = seedUser(makeUser());
    signIn(user);
    h.db.user.findUnique.mockRejectedValue(dbDownError());
    const response = await me();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("failure: a missing AUTH_SECRET is a server fault (500 AUTH_CHECK_FAILED), not a logout", async () => {
    const user = seedUser(makeUser());
    signIn(user);
    vi.stubEnv("AUTH_SECRET", "");
    const response = await me();
    const json = await response.json();
    expect(response.status).toBe(500);
    expect(json.error).toBe("AUTH_CHECK_FAILED");
    expect(JSON.stringify(json)).not.toContain("AUTH_SECRET");
  });
});

/* ------------------------------------------------------------------ */
describe("POST /api/auth/logout", () => {
  const logout = () => logoutPost(makeRequest("/api/auth/logout", { method: "POST" }));

  it("success: revokes every session server-side and deletes the cookie", async () => {
    const user = seedUser(makeUser());
    signIn(user);
    const stolenCookie = h.jar.get(COOKIE) as string;

    const response = await logout();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(h.cookieStore.delete).toHaveBeenCalledWith(COOKIE);
    expect(h.db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } }),
    );

    // a copy of the cookie made before logout is now useless
    h.jar.set(COOKIE, stolenCookie);
    await expect(getOptionalUser()).resolves.toBeNull();
  });

  it("empty data: logging out while not signed in is a harmless 200", async () => {
    const response = await logout();
    expect(response.status).toBe(200);
    expect(h.db.user.update).not.toHaveBeenCalled();
  });

  it("database failure: the browser is still signed out even if the server-side revoke fails", async () => {
    const user = seedUser(makeUser());
    signIn(user);
    h.db.user.update.mockRejectedValue(dbDownError());
    const response = await logout();
    expect(response.status).toBe(200);
    expect(h.cookieStore.delete).toHaveBeenCalledWith(COOKIE);
  });

  it("forbidden: a cross-site logout request (CSRF) is rejected", async () => {
    vi.stubEnv("APP_ORIGIN", "https://gamevortex.example");
    const response = await logoutPost(makeRequest("/api/auth/logout", { method: "POST", headers: { origin: "https://evil.example" } }));
    expect(response.status).toBe(403);
    expect(h.cookieStore.delete).not.toHaveBeenCalled();
  });
});
