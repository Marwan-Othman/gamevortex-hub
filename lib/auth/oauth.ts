import { createPrivateKey, createSign, createPublicKey, randomBytes, verify } from "node:crypto";
import { cookies } from "next/headers";
import { AuthProvider, Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { generateUniqueReferralCode } from "@/lib/referrals";

type OidcProvider = "google" | "apple";
export type OAuthProvider = OidcProvider | "steam";
type Provider = OAuthProvider;
type Claims = { sub: string; email?: string; email_verified?: boolean | string; nonce?: string; exp?: number; iat?: number; iss?: string; aud?: string | string[]; name?: string };
const PROVIDERS: Record<Provider, AuthProvider> = { google: AuthProvider.GOOGLE, apple: AuthProvider.APPLE, steam: AuthProvider.STEAM };
const jwksCache = new Map<OidcProvider, { expires: number; keys: Array<JsonWebKey & { kid?: string; alg?: string }> }>();

export function oauthProviderConfigured(provider: OAuthProvider) {
  if (provider === "google") return !!(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
  if (provider === "apple") return !!(process.env.APPLE_CLIENT_ID?.trim() && process.env.APPLE_TEAM_ID?.trim() && process.env.APPLE_KEY_ID?.trim() && process.env.APPLE_PRIVATE_KEY?.trim());
  return provider === "steam";
}

export function enabledOAuthProviders() {
  return { google: oauthProviderConfigured("google"), apple: oauthProviderConfigured("apple"), steam: oauthProviderConfigured("steam") };
}

function siteOrigin(requestOrigin: string) {
  if (process.env.NODE_ENV === "production" && !process.env.APP_ORIGIN?.trim()) throw new Error("OAUTH_NOT_CONFIGURED");
  const value = process.env.APP_ORIGIN?.trim() || requestOrigin;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("OAUTH_NOT_CONFIGURED"); }
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error("OAUTH_NOT_CONFIGURED");
  return url.origin;
}

export async function beginOAuth(provider: Provider, requestOrigin: string) {
  if (!oauthProviderConfigured(provider)) throw new Error("OAUTH_NOT_CONFIGURED");
  const origin = siteOrigin(requestOrigin);
  const redirectUri = `${origin}/api/auth/oauth/${provider}/callback`;
  const state = randomBytes(32).toString("base64url");
  const nonce = provider === "steam" ? "" : randomBytes(32).toString("base64url");
  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === "production";
  const apple = provider === "apple";
  const options = { httpOnly: true, secure, sameSite: apple ? "none" as const : "lax" as const, path: `/api/auth/oauth/${provider}/callback`, maxAge: 600 };
  cookieStore.set(`gv_oauth_state_${provider}`, state, options);
  if (nonce) cookieStore.set(`gv_oauth_nonce_${provider}`, nonce, options);

  if (provider === "steam") {
    const returnTo = new URL(redirectUri);
    returnTo.searchParams.set("state", state);
    const url = new URL("https://steamcommunity.com/openid/login");
    for (const [key, value] of Object.entries({
      "openid.ns": "http://specs.openid.net/auth/2.0",
      "openid.mode": "checkid_setup",
      "openid.return_to": returnTo.toString(),
      "openid.realm": `${origin}/`,
      "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
      "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    })) url.searchParams.set(key, value);
    return url;
  }

  const url = new URL(provider === "google" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://appleid.apple.com/auth/authorize");
  url.searchParams.set("client_id", provider === "google" ? process.env.GOOGLE_CLIENT_ID! : process.env.APPLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", provider === "google" ? "openid email profile" : "name email");
  url.searchParams.set("state", state);
  if (provider === "google") {
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("prompt", "select_account");
  } else {
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("response_mode", "form_post");
  }
  return url;
}

function appleClientSecret() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: process.env.APPLE_KEY_ID })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: process.env.APPLE_TEAM_ID, iat: now, exp: now + 300, aud: "https://appleid.apple.com", sub: process.env.APPLE_CLIENT_ID })).toString("base64url");
  const content = `${header}.${payload}`;
  const key = createPrivateKey((process.env.APPLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"));
  const signature = createSign("SHA256").update(content).sign({ key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${content}.${signature}`;
}

async function exchangeCode(provider: OidcProvider, code: string, redirectUri: string) {
  const values = new URLSearchParams({
    grant_type: "authorization_code", code, redirect_uri: redirectUri,
    client_id: provider === "google" ? process.env.GOOGLE_CLIENT_ID! : process.env.APPLE_CLIENT_ID!,
    client_secret: provider === "google" ? process.env.GOOGLE_CLIENT_SECRET! : appleClientSecret(),
  });
  let response: Response;
  try {
    response = await fetch(provider === "google" ? "https://oauth2.googleapis.com/token" : "https://appleid.apple.com/auth/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: values, signal: AbortSignal.timeout(12_000), cache: "no-store",
    });
  } catch { throw new Error("OAUTH_EXCHANGE_FAILED"); }
  if (!response.ok) throw new Error("OAUTH_EXCHANGE_FAILED");
  const result = await response.json() as { id_token?: unknown };
  if (typeof result.id_token !== "string") throw new Error("OAUTH_IDENTITY_INVALID");
  return result.id_token;
}

async function providerKeys(provider: OidcProvider) {
  const cached = jwksCache.get(provider);
  if (cached && cached.expires > Date.now()) return cached.keys;
  const url = provider === "google" ? "https://www.googleapis.com/oauth2/v3/certs" : "https://appleid.apple.com/auth/keys";
  let response: Response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(10_000), cache: "no-store" }); }
  catch { throw new Error("OAUTH_IDENTITY_INVALID"); }
  if (!response.ok) throw new Error("OAUTH_IDENTITY_INVALID");
  const body = await response.json() as { keys?: Array<JsonWebKey & { kid?: string; alg?: string }> };
  if (!Array.isArray(body.keys)) throw new Error("OAUTH_IDENTITY_INVALID");
  jwksCache.set(provider, { expires: Date.now() + 5 * 60_000, keys: body.keys });
  return body.keys;
}

async function verifyIdentity(provider: OidcProvider, token: string, expectedNonce: string): Promise<Claims> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("OAUTH_IDENTITY_INVALID");
  let header: { alg?: string; kid?: string };
  let claims: Claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch { throw new Error("OAUTH_IDENTITY_INVALID"); }
  const algorithm = "RS256";
  if (header.alg !== algorithm || !header.kid) throw new Error("OAUTH_IDENTITY_INVALID");
  const key = (await providerKeys(provider)).find((candidate) => candidate.kid === header.kid && candidate.alg === algorithm);
  if (!key) throw new Error("OAUTH_IDENTITY_INVALID");
  const publicKey = createPublicKey({ key: key as unknown as import("node:crypto").JsonWebKey, format: "jwk" });
  const validSignature = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), publicKey, Buffer.from(parts[2], "base64url"));
  const now = Math.floor(Date.now() / 1000);
  const audience = provider === "google" ? process.env.GOOGLE_CLIENT_ID : process.env.APPLE_CLIENT_ID;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const issuerOk = provider === "google" ? ["https://accounts.google.com", "accounts.google.com"].includes(claims.iss || "") : claims.iss === "https://appleid.apple.com";
  if (!validSignature || !claims.sub || !issuerOk || !audiences.includes(audience) || !claims.exp || claims.exp <= now || !claims.iat || claims.iat > now + 60 || now - claims.iat > 600 || claims.nonce !== expectedNonce) throw new Error("OAUTH_IDENTITY_INVALID");
  return claims;
}

async function finishAccount(provider: Provider, accountId: string, email: string | null, emailVerified: boolean, displayName?: string) {
  const providerType = PROVIDERS[provider];
  const connected = await db.oAuthAccount.findUnique({ where: { provider_providerAccountId: { provider: providerType, providerAccountId: accountId } }, include: { user: true } });
  if (connected) { await createSession(connected.userId); return; }
  const verifiedEmail = emailVerified ? email?.trim().toLowerCase() || null : null;
  const normalizedEmail = verifiedEmail || `${provider.toLowerCase()}-${accountId}@accounts.gamevortex.invalid`;
  const matchingUser = verifiedEmail ? await db.user.findUnique({ where: { email: normalizedEmail } }) : null;
  if (email && !emailVerified && await db.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } })) throw new Error("OAUTH_EMAIL_UNVERIFIED");
  const usernameBase = `${provider}_${randomBytes(5).toString("hex")}`.toLowerCase().slice(0, 24);
  let username = usernameBase;
  for (let i = 0; await db.user.findUnique({ where: { username }, select: { id: true } }); i++) username = `${usernameBase.slice(0, 19)}_${i + 1}`;
  const referralCode = matchingUser ? null : await generateUniqueReferralCode(username);
  const result = await db.$transaction(async (tx) => {
    const current = await tx.oAuthAccount.findUnique({ where: { provider_providerAccountId: { provider: providerType, providerAccountId: accountId } }, select: { userId: true } });
    if (current) return current.userId;
    const userId = matchingUser?.id || (await tx.user.create({
      data: { email: normalizedEmail, username, referralCode, passwordHash: null, wallet: { create: {} }, ...(displayName ? { gamerProfile: { create: { displayName: displayName.slice(0, 80) } } } : {}) },
      select: { id: true },
    })).id;
    await tx.oAuthAccount.create({ data: { userId, provider: providerType, providerAccountId: accountId, email: verifiedEmail } });
    return userId;
  });
  await createSession(result);
  if (matchingUser && displayName) await db.gamerProfile.upsert({ where: { userId: matchingUser.id }, create: { userId: matchingUser.id, displayName: displayName.slice(0, 80) }, update: { displayName: displayName.slice(0, 80) } });
}

export async function clearOAuthState(provider: OAuthProvider) {
  const store = await cookies();
  store.delete(`gv_oauth_state_${provider}`);
  store.delete(`gv_oauth_nonce_${provider}`);
}

export async function finishOAuth(provider: Provider, requestUrl: URL, form?: FormData) {
  const store = await cookies();
  const stateCookie = store.get(`gv_oauth_state_${provider}`)?.value;
  const state = form?.get("state")?.toString() || requestUrl.searchParams.get("state");
  if (!stateCookie || !state || stateCookie !== state) throw new Error("OAUTH_STATE_INVALID");
  const origin = siteOrigin(requestUrl.origin);
  const redirectUri = `${origin}/api/auth/oauth/${provider}/callback`;

  if (provider === "steam") {
    const params = new URLSearchParams();
    requestUrl.searchParams.forEach((value, key) => { if (key.startsWith("openid.")) params.set(key, value); });
    const claimed = params.get("openid.claimed_id") || "";
    const identity = params.get("openid.identity") || "";
    const returnTo = params.get("openid.return_to") || "";
    const expectedReturnTo = new URL(redirectUri);
    expectedReturnTo.searchParams.set("state", state);
    const accountMatch = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{5,25})$/.exec(claimed);
    if (!accountMatch || identity !== claimed || returnTo !== expectedReturnTo.toString() || params.get("openid.mode") !== "id_res" || !params.get("openid.op_endpoint")?.startsWith("https://steamcommunity.com/openid/")) throw new Error("OAUTH_IDENTITY_INVALID");
    params.set("openid.mode", "check_authentication");
    let verification: Response;
    try { verification = await fetch("https://steamcommunity.com/openid/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params, signal: AbortSignal.timeout(10_000), cache: "no-store" }); }
    catch { throw new Error("OAUTH_IDENTITY_INVALID"); }
    if (!verification.ok || !/^is_valid:true\s*$/m.test(await verification.text())) throw new Error("OAUTH_IDENTITY_INVALID");
    await finishAccount(provider, accountMatch[1], null, false, "Steam Gamer");
  } else {
    const error = form?.get("error")?.toString() || requestUrl.searchParams.get("error");
    const code = form?.get("code")?.toString() || requestUrl.searchParams.get("code");
    const nonce = store.get(`gv_oauth_nonce_${provider}`)?.value;
    if (error || !code || !nonce) throw new Error("OAUTH_CANCELLED");
    const token = await exchangeCode(provider, code, redirectUri);
    const claims = await verifyIdentity(provider, token, nonce);
    const emailVerified = claims.email_verified === true || claims.email_verified === "true";
    await finishAccount(provider, claims.sub, claims.email || null, emailVerified, claims.name);
  }
  await clearOAuthState(provider);
  return new URL("/", origin);
}
