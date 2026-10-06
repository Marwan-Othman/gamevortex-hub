import { NextRequest, NextResponse } from "next/server";
import { DigitalKeyStatus, LedgerType, Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { reversePointsInTransaction } from "@/lib/points";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = await guardMutation(request, "admin:wallet-order-refund", 10);
  if (blocked) return blocked;

  try {
    const owner = await requireOwner();
    const { id: orderId } = await params;

    const result = await db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          items: { include: { product: true } },
          payments: {
            where: { provider: "wallet" },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (!order) throw new Error("ORDER_NOT_FOUND");

      const walletPayment = order.payments.find(
        (payment) => payment.status === "SUCCEEDED",
      );

      if (!walletPayment) {
        const alreadyRefunded = order.payments.find(
          (payment) =>
            payment.provider === "wallet" && payment.status === "REFUNDED",
        );
        if (alreadyRefunded || order.status === "REFUNDED") {
          return {
            orderId: order.id,
            alreadyRefunded: true,
            refundedAmount: null,
          };
        }
        throw new Error("WALLET_PAYMENT_NOT_FOUND");
      }

      if (order.currency.toUpperCase() !== "USD") {
        throw new Error("WALLET_CURRENCY_NOT_SUPPORTED");
      }

      if (walletPayment.amountCents !== order.totalCents) {
        throw new Error("PAYMENT_AMOUNT_MISMATCH");
      }

      const originalTransactionId = walletPayment.providerPaymentId?.startsWith("wallet:")
        ? walletPayment.providerPaymentId.slice("wallet:".length)
        : null;

      if (!originalTransactionId) {
        throw new Error("WALLET_PAYMENT_REFERENCE_INVALID");
      }

      const originalTransaction = await tx.walletTransaction.findUnique({
        where: { id: originalTransactionId },
      });

      if (
        !originalTransaction ||
        originalTransaction.type !== "PURCHASE" ||
        originalTransaction.referenceType !== "ORDER" ||
        originalTransaction.referenceId !== order.id
      ) {
        throw new Error("WALLET_PAYMENT_REFERENCE_INVALID");
      }

      const refundIdempotencyKey = `wallet-refund:${order.id}`;
      const existingRefund = await tx.walletTransaction.findUnique({
        where: { idempotencyKey: refundIdempotencyKey },
      });

      if (existingRefund) {
        if (
          existingRefund.type !== "REFUND" ||
          existingRefund.referenceType !== "ORDER" ||
          existingRefund.referenceId !== order.id
        ) {
          throw new Error("WALLET_IDEMPOTENCY_CONFLICT");
        }

        return {
          orderId: order.id,
          alreadyRefunded: true,
          refundedAmount: existingRefund.amount.abs().toString(),
        };
      }

      const wallet = await tx.wallet.findUnique({
        where: { userId: order.userId },
      });
      if (!wallet) throw new Error("WALLET_NOT_FOUND");

      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Wallet" WHERE "id" = ${wallet.id} FOR UPDATE`,
      );

      const lockedWallet = await tx.wallet.findUniqueOrThrow({
        where: { id: wallet.id },
      });

      const amount = new Prisma.Decimal(order.totalCents).div(100);
      const before = lockedWallet.balance;
      const after = before.add(amount);

      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balance: after },
      });

      const refundTransaction = await tx.walletTransaction.create({
        data: {
          userId: order.userId,
          walletId: wallet.id,
          type: "REFUND",
          amount,
          balanceBefore: before,
          balanceAfter: after,
          currency: order.currency,
          referenceType: "ORDER",
          referenceId: order.id,
          idempotencyKey: refundIdempotencyKey,
          metadata: {
            orderId: order.id,
            source: "GAMEVORTEX_STORE_WALLET_REFUND",
            originalWalletTransactionId: originalTransaction.id,
            originalPaymentId: walletPayment.id,
            refundedBy: owner.id,
          },
        },
      });

      await tx.payment.update({
        where: { id: walletPayment.id },
        data: {
          status: "REFUNDED",
          rawEvent: {
            source: "GAMEVORTEX_WALLET_REFUND",
            walletTransactionId: refundTransaction.id,
            originalWalletTransactionId: originalTransaction.id,
            refundedBy: owner.id,
          },
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: "REFUNDED",
          status: "REFUNDED",
        },
      });

      const orderItemIds = order.items.map((item) => item.id);
      if (orderItemIds.length > 0) {
        await tx.digitalKey.updateMany({
          where: {
            orderItemId: { in: orderItemIds },
            status: DigitalKeyStatus.DELIVERED,
          },
          data: {
            status: DigitalKeyStatus.REVOKED,
            revokedAt: new Date(),
          },
        });
      }

      const gameIds = order.items
        .map((item) => item.product.gameId)
        .filter((gameId): gameId is string => Boolean(gameId));

      if (gameIds.length > 0) {
        await tx.entitlement.updateMany({
          where: {
            userId: order.userId,
            gameId: { in: gameIds },
          },
          data: { revokedAt: new Date() },
        });
      }

      const originalPaymentKey = `purchase-points:${order.id}:wallet:${originalTransaction.id}`;
      const buyerReward = await tx.pointLedger.findUnique({
        where: { idempotencyKey: originalPaymentKey },
        select: { amount: true, userId: true },
      });

      if (
        buyerReward &&
        buyerReward.userId === order.userId &&
        buyerReward.amount > 0
      ) {
        await reversePointsInTransaction(tx, {
          userId: order.userId,
          amount: buyerReward.amount,
          reason: "STORE_PURCHASE_REFUND",
          sourceId: order.id,
          idempotencyKey: `refund-points:${order.id}:wallet:${refundTransaction.id}`,
        });
      }

      const ownerWallet = await tx.ownerWallet.findUnique({
        where: { ownerId: owner.id },
      });

      if (ownerWallet) {
        const saleRevenueKey = `sale-revenue:${order.id}:wallet:${originalTransaction.id}`;
        const saleRevenue = await tx.ownerLedger.findUnique({
          where: { idempotencyKey: saleRevenueKey },
          select: { id: true, walletId: true, usdAmount: true },
        });

        if (saleRevenue) {
          await tx.ownerLedger.create({
            data: {
              walletId: saleRevenue.walletId,
              type: LedgerType.REFUND,
              points: 0,
              usdAmount: saleRevenue.usdAmount
                ? saleRevenue.usdAmount.neg()
                : null,
              currency: order.currency,
              provider: "wallet",
              providerTransactionId: refundTransaction.id,
              idempotencyKey: `refund-revenue:${order.id}:wallet:${refundTransaction.id}`,
              metadata: {
                orderId: order.id,
                source: "GAMEVORTEX_STORE_WALLET_REFUND",
                originalLedgerId: saleRevenue.id,
              },
            },
          });
        }

        const salePointsKey = `sale-points:${order.id}:wallet:${originalTransaction.id}`;
        const salePoints = await tx.ownerLedger.findUnique({
          where: { idempotencyKey: salePointsKey },
          select: { id: true, walletId: true, points: true },
        });

        if (salePoints && salePoints.points > 0) {
          const pointsToReturn = Math.min(
            salePoints.points,
            Math.max(ownerWallet.availablePoints, 0),
          );

          if (pointsToReturn > 0) {
            await tx.ownerWallet.update({
              where: { id: ownerWallet.id },
              data: {
                availablePoints: { decrement: pointsToReturn },
              },
            });
          }

          await tx.ownerLedger.create({
            data: {
              walletId: salePoints.walletId,
              type: LedgerType.REFUND,
              points: -pointsToReturn,
              usdAmount: null,
              currency: "USD",
              provider: "wallet",
              providerTransactionId: refundTransaction.id,
              idempotencyKey: `refund-owner-points:${order.id}:wallet:${refundTransaction.id}`,
              metadata: {
                orderId: order.id,
                source: "GAMEVORTEX_STORE_WALLET_REFUND",
                originalLedgerId: salePoints.id,
                originalPoints: salePoints.points,
                refundedPoints: pointsToReturn,
              },
            },
          });
        }
      }

      await tx.notification.create({
        data: {
          userId: order.userId,
          type: "STORE_PURCHASE_REFUNDED",
          title: "تم استرداد عملية الشراء",
          body: `تمت إعادة ${amount.toString()} ${order.currency} إلى محفظتك المالية.`,
          metadata: {
            orderId: order.id,
            provider: "wallet",
            walletTransactionId: refundTransaction.id,
          },
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: owner.id,
          action: "WALLET_ORDER_REFUNDED",
          entityType: "Order",
          entityId: order.id,
          metadata: {
            orderId: order.id,
            userId: order.userId,
            amountCents: order.totalCents,
            currency: order.currency,
            walletTransactionId: refundTransaction.id,
            paymentId: walletPayment.id,
          },
        },
      });

      return {
        orderId: order.id,
        alreadyRefunded: false,
        refundedAmount: amount.toString(),
        walletBalance: after.toString(),
      };
    });

    return NextResponse.json(result, {
      status: result.alreadyRefunded ? 200 : 201,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "WALLET_REFUND_FAILED";

    const status =
      message === "ORDER_NOT_FOUND" ? 404 :
      message === "WALLET_PAYMENT_NOT_FOUND" ? 409 :
      message === "WALLET_CURRENCY_NOT_SUPPORTED" ? 409 :
      message === "PAYMENT_AMOUNT_MISMATCH" ? 409 :
      message === "WALLET_PAYMENT_REFERENCE_INVALID" ? 409 :
      message === "WALLET_IDEMPOTENCY_CONFLICT" ? 409 :
      message === "UNAUTHORIZED" ? 401 :
      400;

    return NextResponse.json({ error: message }, { status });
  }
}
