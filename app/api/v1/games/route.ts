import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { clientKey, rateLimitAsync } from "@/lib/security";
import { hashApiKey } from "@/lib/gamevortex-api/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: string, status: number, retryAfter?: number) {
  return NextResponse.json({ error }, {
    status,
    headers: { "Cache-Control": "no-store", ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) },
  });
}

export async function GET(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  let secretHash = "";
  try {
    secretHash = hashApiKey(token);
  } catch {
    const limited = await rateLimitAsync(clientKey(request, "api:v1:games:invalid"), 30, 60_000);
    if (!limited.allowed) return errorResponse("RATE_LIMITED", 429, limited.retryAfter);
    return errorResponse("UNAUTHORIZED", 401);
  }

  const apiKey = await db.gameVortexApiKey.findUnique({
    where: { secretHash },
    select: { id: true, userId: true, revokedAt: true, requiresPurchase: true },
  });
  if (!apiKey || apiKey.revokedAt) return errorResponse("UNAUTHORIZED", 401);

  const limited = await rateLimitAsync(`api:v1:games:key:${apiKey.id}`, 120, 60_000);
  if (!limited.allowed) return errorResponse("RATE_LIMITED", 429, limited.retryAfter);

  if (apiKey.requiresPurchase) {
    const access = await db.apiAccessPurchase.findFirst({ where: { userId: apiKey.userId, status: "SUCCEEDED" }, select: { id: true } });
    if (!access) return errorResponse("API_ACCESS_REQUIRED", 403);
  }

  const enabled = await db.gameVortexApiKey.updateMany({
    where: { id: apiKey.id, revokedAt: null },
    data: { lastUsedAt: new Date() },
  });
  if (enabled.count !== 1) return errorResponse("UNAUTHORIZED", 401);

  const params = request.nextUrl.searchParams;
  const pageValue = Number(params.get("page") || 1);
  const limitValue = Number(params.get("limit") || 24);
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? Math.min(pageValue, 100_000) : 1;
  const limit = Number.isSafeInteger(limitValue) && limitValue > 0 ? Math.min(limitValue, 50) : 24;
  const search = params.get("search")?.trim().slice(0, 100);
  const where = {
    published: true,
    ...(search ? { OR: [
      { titleAr: { contains: search, mode: "insensitive" as const } },
      { titleEn: { contains: search, mode: "insensitive" as const } },
      { slug: { contains: search, mode: "insensitive" as const } },
    ] } : {}),
  };

  try {
    const [games, total] = await Promise.all([
      db.game.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          slug: true,
          titleAr: true,
          titleEn: true,
          description: true,
          platform: true,
          genre: true,
          priceCents: true,
          discountPercent: true,
          coverUrl: true,
          ratingAverage: true,
          ratingCount: true,
          featured: true,
        },
      }),
      db.game.count({ where }),
    ]);
    await db.gameVortexApiRequestLog.create({ data: { apiKeyId: apiKey.id, route: "/api/v1/games", status: 200 } });
    return NextResponse.json({ data: games, pagination: { page, limit, total, pages: Math.ceil(total / limit) } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    await db.gameVortexApiRequestLog.create({ data: { apiKeyId: apiKey.id, route: "/api/v1/games", status: 500 } }).catch(() => undefined);
    return errorResponse("API_REQUEST_FAILED", 500);
  }
}