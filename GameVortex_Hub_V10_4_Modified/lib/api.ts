import { NextRequest, NextResponse } from "next/server";
import { clientKey, rateLimitAsync, sameOrigin } from "./security";

async function guard(request: Request, scope: string, limit: number) {
  const result = await rateLimitAsync(clientKey(request, scope), limit, 60_000);
  if (!result.allowed) return NextResponse.json({ error: "RATE_LIMITED", retryAfter: result.retryAfter }, { status: 429, headers: { "Retry-After": String(result.retryAfter) } });
  return null;
}

export async function guardMutation(request: NextRequest | Request, scope: string, limit = 30) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "CSRF_ORIGIN_REJECTED" }, { status: 403 });
  return guard(request, scope, limit);
}

export async function guardRead(request: NextRequest | Request, scope: string, limit = 120) {
  return guard(request, scope, limit);
}
