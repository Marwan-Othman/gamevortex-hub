import { NextRequest, NextResponse } from "next/server";
import { guardRead } from "@/lib/api";
import { beginOAuth, OAuthProvider, oauthProviderConfigured } from "@/lib/auth/oauth";

const supported = new Set<OAuthProvider>(["google", "apple", "steam"]);

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider: value } = await context.params;
  if (!supported.has(value as OAuthProvider)) return NextResponse.json({ error: "OAUTH_PROVIDER_UNAVAILABLE" }, { status: 404 });
  const provider = value as OAuthProvider;
  const blocked = await guardRead(request, `auth:oauth:${provider}`, 20);
  if (blocked) return blocked;
  if (!oauthProviderConfigured(provider)) return NextResponse.redirect(new URL("/auth/login?error=oauth_unavailable", request.url));
  try {
    const destination = await beginOAuth(provider, request.nextUrl.origin);
    return NextResponse.redirect(destination, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.redirect(new URL("/auth/login?error=oauth_unavailable", request.url));
  }
}
