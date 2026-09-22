import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { logSystemError } from "@/lib/observability";
import { debitPoints } from "@/lib/points";
import {
  getUserPointsTier,
  validateUserWithdrawal,
  POINTS_PER_USD,
} from "@/lib/points-economy";

/*
 * GameVortex Hub — Master Task Plan Section 3
 * Item 7: نظام السحب والمحافظ (VIP / مستخدم عادي — المالك له مسار منفصل
 *         عبر /api/owner/withdraw).
 * Item 11: خصم النقاط عند السحب — يتم فعليًا داخل debitPoints() بشكل
 *          ذري (Serializable transaction) قبل إنشاء سجل السحب، بحيث
 *          لا يمكن أبدًا إنشاء طلب سحب بدون خصم النقاط فعليًا أولًا.
 *
 * This is a request/ledger record only — no external payout provider
 * is wired up yet. Admin fulfils PENDING/PROCESSING requests manually
 * for now (see PROGRESS_TRACKER.md), same maturity level as the
 * existing owner withdrawal flow before a payout provider is chosen.
 */

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

export async function POST(req: NextRequest) {
  const blocked = await guardMutation(
    req,
    "wallet:withdraw",
    5,
  );

  if (blocked) {
    return blocked;
  }

  let userId: string | undefined;

  try {
    const user = await requireUser();
    userId = user.id;

    let body: unknown;

    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "INVALID_JSON" },
        { status: 400 },
      );
    }

    const rawBody =
      body && typeof body === "object"
        ? (body as Record<string, unknown>)
        : {};

    const points = Number(rawBody.points);

    const headerKey = req.headers.get("idempotency-key");
    const bodyKey = rawBody.idempotencyKey;
    const key = String(headerKey ?? bodyKey ?? "").trim();

    if (
      !key ||
      key.length > MAX_IDEMPOTENCY_KEY_LENGTH
    ) {
      return NextResponse.json(
        { error: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 },
      );
    }

    const tier = await getUserPointsTier(userId);

    if (tier === "OWNER") {
      return NextResponse.json(
        {
          error: "OWNER_MUST_USE_OWNER_WITHDRAW_ENDPOINT",
        },
        { status: 400 },
      );
    }

    let usd: number;

    try {
      usd = validateUserWithdrawal(tier, points);
    } catch {
      return NextResponse.json(
        {
          error: "MINIMUM_WITHDRAWAL_NOT_MET",
          minPoints: undefined,
        },
        { status: 400 },
      );
    }

    // Debit points atomically first (item 11). If the user doesn't
    // have enough points, debitPoints() itself throws and nothing
    // below runs.
    await debitPoints({
      userId,
      amount: points,
      reason: "WITHDRAWAL_REQUEST",
      idempotencyKey: `withdraw-debit:${key}`,
      metadata: { tier, points, usd },
    });

    const request = await db.userWithdrawalRequest.create({
      data: {
        userId,
        tier,
        points,
        usdAmount: usd,
        conversionRate: POINTS_PER_USD[tier],
        idempotencyKey: key,
      },
    });

    return NextResponse.json({
      id: request.id,
      status: request.status,
      points: request.points,
      usdAmount: request.usdAmount,
      tier,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "";

    if (message === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "UNAUTHORIZED" },
        { status: 401 },
      );
    }

    if (message.startsWith("Insufficient points")) {
      return NextResponse.json(
        { error: "INSUFFICIENT_POINTS" },
        { status: 400 },
      );
    }

    await logSystemError("wallet.withdraw", error, {
      userId,
    });

    return NextResponse.json(
      { error: "WITHDRAWAL_FAILED" },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const blocked = await guardMutation(
    req,
    "wallet:withdraw:list",
    30,
  );

  if (blocked) {
    return blocked;
  }

  try {
    const user = await requireUser();

    const requests =
      await db.userWithdrawalRequest.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      });

    return NextResponse.json({ requests });
  } catch {
    return NextResponse.json(
      { error: "UNAUTHORIZED" },
      { status: 401 },
    );
  }
}
