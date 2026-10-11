import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { logSystemError } from "@/lib/observability";
import { expireDueVipSubscriptions } from "@/lib/vip-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  // A missing or short secret disables the endpoint entirely.
  if (!secret || secret.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * GET /api/cron/vip-expiry
 * Moves subscriptions whose end date has passed from ACTIVE to EXPIRED and
 * notifies their owners. Access never depends on this job (it is decided by
 * expiresAt at request time); it keeps stored status and history accurate.
 * Safe to run repeatedly and concurrently.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    const result = await expireDueVipSubscriptions(500);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await logSystemError("vip:expiry-cron-failed", error);
    return NextResponse.json({ ok: false, error: "VIP_EXPIRY_FAILED" }, { status: 500 });
  }
}
