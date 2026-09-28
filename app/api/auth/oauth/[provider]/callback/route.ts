import { NextRequest, NextResponse } from "next/server";
import { guardRead } from "@/lib/api";
import { clearOAuthState, finishOAuth, OAuthProvider, oauthProviderConfigured } from "@/lib/auth/oauth";

const supported = new Set<OAuthProvider>(["google", "apple", "steam"]);

async function failed(request: NextRequest, provider: OAuthProvider) {
  await clearOAuthState(provider).catch(() => undefined);
  const origin = process.env.APP_ORIGIN?.trim() || request.nextUrl.origin;
  return NextResponse.redirect(new URL("/auth/login?error=oauth_failed", origin), { status: 303, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider: value } = await context.params;
  if (!supported.has(value as OAuthProvider)) return NextResponse.json({ error: "OAUTH_PROVIDER_UNAVAILABLE" }, { status: 404 });
  const provider = value as OAuthProvider;
  const blocked = await guardRead(request, `auth:oauth:callback:${provider}`, 30);
  if (blocked) return blocked;
  if (!oauthProviderConfigured(provider) || provider === "apple") return failed(request, provider);
  try {
    const destination = await finishOAuth(provider, request.nextUrl);
    return NextResponse.redirect(destination, { status: 303, headers: { "Cache-Control": "no-store" } });
  } catch {
    return failed(request, provider);
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider: value } = await context.params;
  if (value !== "apple" || !oauthProviderConfigured("apple")) return NextResponse.json({ error: "OAUTH_PROVIDER_UNAVAILABLE" }, { status: 404 });
  const blocked = await guardRead(request, "auth:oauth:callback:apple", 30);
  if (blocked) return blocked;
  try {
    const form = await request.formData();
    const destination = await finishOAuth("apple", request.nextUrl, form);
    return NextResponse.redirect(destination, { status: 303, headers: { "Cache-Control": "no-store" } });
  } catch {
    return failed(request, "apple");
  }
}
