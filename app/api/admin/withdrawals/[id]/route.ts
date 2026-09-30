import { NextRequest, NextResponse } from "next/server";
import { LedgerType, WithdrawalStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { validateOwnerWithdrawalTransition } from "@/lib/owner-points";

export const runtime = "nodejs";

const updateSchema = z.object({
  status: z.enum(["PENDING", "PROCESSING", "PAID", "SETTLED", "FAILED", "REJECTED", "CANCELLED"]),
  providerTransactionId: z.string().trim().min(1).max(255).optional(),
  failureReason: z.string().trim().min(1).max(500).optional(),
});

function isPayoutStatus(status: WithdrawalStatus) {
  return status === "PAID" || status === "SETTLED";
}

function isReleaseStatus(status: WithdrawalStatus) {
  return status === "FAILED" || status === "REJECTED" || status === "CANCELLED";
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const blocked = await guardMutation(request, "admin:withdrawals", 30);
  if (blocked) return blocked;

  try {
    const owner = await requireOwner();
    const { id } = await context.params;
    const body = updateSchema.parse(await request.json());

    if (isPayoutStatus(body.status) && !body.providerTransactionId) {
      return NextResponse.json({ error: "PAYOUT_REFERENCE_REQUIRED" }, { status: 400 });
    }

    const result = await db.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawalRequest.findUnique({
        where: { id },
        include: { ownerWallet: true },
      });

      if (!withdrawal) throw new Error("WITHDRAWAL_NOT_FOUND");
      if (withdrawal.status === body.status) return { withdrawal, replayed: true };

      const transition = validateOwnerWithdrawalTransition(withdrawal.status, body.status);
      const wallet = withdrawal.ownerWallet;

      if (transition.releasesPoints) {
        const updatedWallet = await tx.ownerWallet.updateMany({
          where: { id: wallet.id, pendingPoints: { gte: withdrawal.points } },
          data: {
            pendingPoints: { decrement: withdrawal.points },
            availablePoints: { increment: withdrawal.points },
          },
        });
        if (updatedWallet.count !== 1) throw new Error("OWNER_WALLET_RESERVATION_MISMATCH");

        await tx.ownerLedger.create({
          data: {
            walletId: wallet.id,
            type: LedgerType.POINTS_RETURNED,
            points: withdrawal.points,
            usdAmount: withdrawal.usdAmount,
            conversionRate: withdrawal.conversionRate,
            withdrawalId: withdrawal.id,
            idempotencyKey: `withdrawal:${withdrawal.id}:points-returned`,
            metadata: { reason: body.failureReason ?? body.status },
          },
        });
      } else if (transition.settlesPayout) {
        const updatedWallet = await tx.ownerWallet.updateMany({
          where: { id: wallet.id, pendingPoints: { gte: withdrawal.points } },
          data: { pendingPoints: { decrement: withdrawal.points } },
        });
        if (updatedWallet.count !== 1) throw new Error("OWNER_WALLET_RESERVATION_MISMATCH");

        await tx.ownerLedger.create({
          data: {
            walletId: wallet.id,
            type: LedgerType.PAYOUT_SETTLED,
            points: 0,
            usdAmount: withdrawal.usdAmount,
            currency: withdrawal.currency,
            conversionRate: withdrawal.conversionRate,
            withdrawalId: withdrawal.id,
            providerTransactionId: body.providerTransactionId,
            idempotencyKey: `withdrawal:${withdrawal.id}:payout-settled`,
            metadata: { status: body.status },
          },
        });
      }

      const updated = await tx.withdrawalRequest.update({
        where: { id: withdrawal.id },
        data: {
          status: body.status,
          providerTransactionId: body.providerTransactionId ?? withdrawal.providerTransactionId,
          failureReason: body.failureReason,
          processedAt: isPayoutStatus(body.status) || isReleaseStatus(body.status) ? new Date() : null,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: owner.id,
          action: "OWNER_WITHDRAWAL_STATUS_CHANGED",
          entityType: "WithdrawalRequest",
          entityId: withdrawal.id,
          metadata: {
            from: withdrawal.status,
            to: body.status,
            points: withdrawal.points,
            usdAmount: withdrawal.usdAmount.toString(),
            providerTransactionId: body.providerTransactionId,
            failureReason: body.failureReason,
          },
        },
      });

      return { withdrawal: updated, replayed: false };
    });

    return NextResponse.json({ ok: true, replayed: result.replayed, withdrawal: result.withdrawal });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WITHDRAWAL_UPDATE_FAILED";
    const status = message === "UNAUTHORIZED" ? 401
      : message === "FORBIDDEN" ? 403
        : message === "WITHDRAWAL_NOT_FOUND" ? 404
          : message === "WITHDRAWAL_ALREADY_FINAL" ? 409
            : message === "INVALID_WITHDRAWAL_TRANSITION" ? 409
              : message === "OWNER_WALLET_RESERVATION_MISMATCH" ? 409
                : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
