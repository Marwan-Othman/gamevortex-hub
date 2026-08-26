import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";

function configurationStatus() {
  return {
    database: true,
    auth: Boolean(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32),
    owner: Boolean(process.env.OWNER_EMAIL),
    payments: Boolean(process.env.PAYMENT_PROVIDER && (process.env.STRIPE_SECRET_KEY || process.env.PAYMENT_PROVIDER_BASE_URL)),
    email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    ai: Boolean(process.env.AI_PROVIDER_BASE_URL && process.env.AI_PROVIDER_API_KEY),
    quran: true,
    rateLimit: process.env.RATE_LIMIT_STORE === "upstash"
      ? Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN)
      : true,
  };
}

export async function GET(request: NextRequest) {
  const administrativeCheck = request.headers.get("x-admin-health") === "1";
  if (administrativeCheck) {
    try {
      await requireOwner();
    } catch {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }
  }

  try {
    await db.$queryRaw`SELECT 1`;

    if (!administrativeCheck) {
      return NextResponse.json({ status: "ok", database: "up" }, { headers: { "Cache-Control": "no-store" } });
    }

    const configured = configurationStatus();
    const degraded = Object.values(configured).some((value) => !value);
    return NextResponse.json(
      { status: degraded ? "degraded" : "ok", database: "up", configured },
      { status: degraded ? 503 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ status: "degraded", database: "down" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
