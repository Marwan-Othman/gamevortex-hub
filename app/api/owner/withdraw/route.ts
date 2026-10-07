import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../../lib/prisma";
import { requireOwner } from "../../../../lib/auth";
import {
  validateOwnerWithdrawal,
  validateOwnerPointsBalance,
  OWNER_POINTS_PER_USD,
} from "../../../../lib/owner-points";
import { guardMutation } from "../../../../lib/api";
import { logSystemError } from "../../../../lib/observability";

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

export async function POST(req: NextRequest) {
  const blocked = await guardMutation(req, "owner:withdraw", 10);

  if (blocked) {
    return blocked;
  }

  let ownerId: string | undefined;

  try {
    const owner = await requireOwner();
    ownerId = owner.id;

    if (process.env.OWNER_WITHDRAWAL_ENABLED !== "true") {
      return NextResponse.json(
        { error: "OWNER_WITHDRAWAL_DISABLED" },
        { status: 503 },
      );
    }

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

    if (!key || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      return NextResponse.json(
        { error: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 },
      );
    }

    const usd = validateOwnerWithdrawal(points);

    const result = await db.$transaction(async (tx) => {
      const wallet = await tx.ownerWallet.findUnique({
        where: {
          ownerId: owner.id,
        },
      });

      if (!wallet) {
        throw new Error("OWNER_WALLET_NOT_FOUND");
      }

      const existing = await tx.withdrawalRequest.findUnique({
        where: {
          idempotencyKey: key,
        },
      });

      if (existing) {
        if (existing.ownerWalletId !== wallet.id) {
          throw new Error("IDEMPOTENCY_KEY_CONFLICT");
        }

        if (
          existing.points !== points ||
          Number(existing.usdAmount) !== usd
        ) {
          throw new Error("IDEMPOTENCY_KEY_CONFLICT");
        }

        return {
          withdrawal: existing,
          replayed: true,
        };
      }

      validateOwnerPointsBalance(
        wallet.availablePoints,
        points,
      );

      const withdrawal = await tx.withdrawalRequest.create({
        data: {
          ownerWalletId: wallet.id,
          points,
          usdAmount: usd,
          conversionRate: OWNER_POINTS_PER_USD,
          idempotencyKey: key,
          status: "PENDING",
        },
      });

      const updatedWallet = await tx.ownerWallet.updateMany({
        where: {
          id: wallet.id,
          availablePoints: {
            gte: points,
          },
        },
        data: {
          availablePoints: {
            decrement: points,
          },
          pendingPoints: {
            increment: points,
          },
        },
      });

      if (updatedWallet.count !== 1) {
        throw new Error("INSUFFICIENT_POINTS");
      }

      await tx.ownerLedger.create({
        data: {
          walletId: wallet.id,
          type: "POINTS_RESERVED",
          points: -points,
          usdAmount: usd,
          conversionRate: OWNER_POINTS_PER_USD,
          withdrawalId: withdrawal.id,
          idempotencyKey: `${key}:reserve`,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: owner.id,
          action: "OWNER_WITHDRAWAL_REQUESTED",
          entityType: "WithdrawalRequest",
          entityId: withdrawal.id,
          metadata: {
            points,
            usd,
            conversionRate: OWNER_POINTS_PER_USD,
          },
        },
      });

      return {
        withdrawal,
        replayed: false,
      };
    });

    return NextResponse.json(
      result.withdrawal,
      {
        status: result.replayed ? 200 : 201,
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "INTERNAL_ERROR";

    const status =
      message === "UNAUTHORIZED"
        ? 401
        : message === "FORBIDDEN"
          ? 403
          : message === "OWNER_WALLET_NOT_FOUND"
            ? 404
            : 400;

    const ignoredErrors = new Set([
      "UNAUTHORIZED",
      "FORBIDDEN",
      "MINIMUM_WITHDRAWAL_NOT_MET",
      "IDEMPOTENCY_KEY_REQUIRED",
      "IDEMPOTENCY_KEY_CONFLICT",
      "INSUFFICIENT_POINTS",
      "INVALID_JSON",
      "INVALID_OWNER_POINTS",
      "INVALID_OWNER_BALANCE",
    ]);

    if (!ignoredErrors.has(message)) {
      await logSystemError(
        "owner:withdraw",
        error,
        {
          statusCode: status,
          userId: ownerId,
        },
      );
    }

    return NextResponse.json(
      { error: message },
      { status },
    );
  }
}
