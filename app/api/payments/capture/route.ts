import {
  NextRequest,
  NextResponse,
} from "next/server";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  db,
} from "@/lib/prisma";

import {
  requireUser,
} from "@/lib/auth";

import { guardMutation, publicErrorCode } from "@/lib/api";

import {
  ConfiguredPaymentProvider,
} from "@/lib/payments";

export const runtime =
  "nodejs";

type VerifiedPayPalCapture = Awaited<
  ReturnType<ConfiguredPaymentProvider["capturePayment"]>
>;

/**
 * A successful PayPal capture must also settle the local wallet.
 * Webhooks remain enabled for asynchronous events and refunds, but a missed
 * completion webhook must not leave real, captured funds in pendingBalance.
 * Deposit and wallet row locks plus the same idempotency key used by the
 * webhook make this safe against concurrent/replayed callbacks.
 */
async function settleWalletDepositAfterCapture(
  userId: string,
  depositId: string,
  capture: VerifiedPayPalCapture,
): Promise<{ status: "COMPLETED" | "REFUNDED"; reused: boolean }> {
  return db.$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "WalletDeposit" WHERE "id" = ${depositId} FOR UPDATE`,
    );

    const deposit = await transaction.walletDeposit.findUnique({
      where: { id: depositId },
    });
    if (!deposit || deposit.userId !== userId) {
      throw new Error("PAYMENT_REFERENCE_NOT_FOUND");
    }
    if (deposit.provider !== "paypal") {
      throw new Error("PAYMENT_PROVIDER_MISMATCH");
    }
    if (deposit.providerPaymentId !== capture.paymentId) {
      throw new Error("PAYMENT_ID_MISMATCH");
    }
    if (
      deposit.amountCents !== capture.amountCents ||
      deposit.currency.toUpperCase() !== capture.currency.toUpperCase()
    ) {
      throw new Error("PAYMENT_AMOUNT_MISMATCH");
    }

    // A refund is terminal for this deposit. A late capture response must not
    // silently reactivate funds that have already been refunded.
    if (deposit.status === "REFUNDED") {
      return { status: "REFUNDED" as const, reused: true };
    }

    const idempotencyKey =
      `wallet-deposit:${deposit.id}:paypal:${capture.captureId}`;
    const existingTransaction = await transaction.walletTransaction.findUnique({
      where: { idempotencyKey },
      select: { id: true },
    });

    if (existingTransaction) {
      if (deposit.status !== "COMPLETED") {
        await transaction.walletDeposit.update({
          where: { id: deposit.id },
          data: { status: "COMPLETED" },
        });
      }
      return { status: "COMPLETED" as const, reused: true };
    }

    const amount = new Prisma.Decimal(deposit.amountCents).div(100);
    const wallet = await transaction.wallet.upsert({
      where: { userId: deposit.userId },
      create: {
        userId: deposit.userId,
        balance: new Prisma.Decimal(0),
        pendingBalance: new Prisma.Decimal(0),
      },
      update: {},
    });

    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Wallet" WHERE "id" = ${wallet.id} FOR UPDATE`,
    );
    const lockedWallet = await transaction.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
    });

    const pendingToRelease =
      deposit.status === "PENDING"
        ? (lockedWallet.pendingBalance.lt(amount)
            ? lockedWallet.pendingBalance
            : amount)
        : new Prisma.Decimal(0);
    const pendingShortfall =
      deposit.status === "PENDING"
        ? amount.sub(pendingToRelease)
        : new Prisma.Decimal(0);

    const before = lockedWallet.balance;
    const after = before.add(amount);
    const settled = await transaction.wallet.updateMany({
      where: {
        id: wallet.id,
        balance: before,
        pendingBalance: { gte: pendingToRelease },
      },
      data: {
        balance: after,
        pendingBalance: { decrement: pendingToRelease },
      },
    });
    if (settled.count !== 1) {
      throw new Error("WALLET_BALANCE_CHANGED");
    }

    // Matches the webhook idempotency key so either path can win the race
    // without double-crediting the wallet.
    await transaction.walletTransaction.create({
      data: {
        userId: deposit.userId,
        walletId: wallet.id,
        type: "DEPOSIT",
        amount,
        balanceBefore: before,
        balanceAfter: after,
        currency: deposit.currency,
        referenceType: "WALLET_DEPOSIT",
        referenceId: deposit.id,
        idempotencyKey,
        metadata: {
          provider: "paypal",
          paymentId: capture.captureId,
          orderId: capture.paymentId,
          settlementSource: "verified_capture_response",
          ...(pendingShortfall.gt(0)
            ? { pendingShortfall: pendingShortfall.toString() }
            : {}),
        },
      },
    });

    // Keep providerPaymentId as the PayPal ORDER ID. The capture ID belongs in
    // the ledger idempotency key, not in this checkout-reference column.
    await transaction.walletDeposit.update({
      where: { id: deposit.id },
      data: { status: "COMPLETED" },
    });

    const existingNotification = await transaction.notification.findFirst({
      where: {
        userId: deposit.userId,
        type: "WALLET_DEPOSIT_COMPLETED",
        metadata: {
          path: ["depositId"],
          equals: deposit.id,
        },
      },
      select: { id: true },
    });
    if (!existingNotification) {
      await transaction.notification.create({
        data: {
          userId: deposit.userId,
          type: "WALLET_DEPOSIT_COMPLETED",
          title: "تمت إضافة الأموال إلى محفظتك",
          body: `تمت إضافة ${deposit.amountCents / 100} ${deposit.currency} إلى المحفظة المالية.`,
          metadata: {
            depositId: deposit.id,
            provider: "paypal",
            paymentId: capture.captureId,
          },
        },
      });
    }

    return { status: "COMPLETED" as const, reused: false };
  });
}

const schema =
  z.object({
    referenceId:
      z.string()
        .trim()
        .min(1)
        .max(128),

    paymentId:
      z.string()
        .trim()
        .min(1)
        .max(255),
  });

/**
 * Captures an approved PayPal order.
 *
 * The payment provider's webhook remains the
 * authoritative source for fulfillment/activation.
 * This endpoint only moves PayPal from APPROVED
 * to CAPTURED.
 */
export async function POST(
  request: NextRequest,
) {
  const blocked =
    await guardMutation(
      request,
      "payments:capture",
      10,
    );

  if (blocked) {
    return blocked;
  }

  try {
    const user =
      await requireUser();

    const body =
      schema.parse(
        await request.json(),
      );

    const provider =
      new ConfiguredPaymentProvider();

    if (
      provider.name !==
      "paypal"
    ) {
      return NextResponse.json(
        {
          error:
            "PAYMENT_CAPTURE_NOT_SUPPORTED",
        },
        {
          status: 400,
        },
      );
    }

    const order =
      await db.order.findFirst({
        where: {
          id:
            body.referenceId,
          userId:
            user.id,
        },
        select: {
          id: true,
          paymentProvider: true,
          paymentStatus: true,
          totalCents: true,
        },
      });

    if (order) {
      if (
        order.paymentProvider !==
        "paypal"
      ) {
        return NextResponse.json(
          {
            error:
              "PAYMENT_PROVIDER_MISMATCH",
          },
          {
            status: 409,
          },
        );
      }

      if (
        order.paymentStatus ===
        "SUCCEEDED"
      ) {
        return NextResponse.json({
          ok: true,
          reused: true,
          provider:
            "paypal",
          paymentId:
            body.paymentId,
        });
      }

      const payment =
        await db.payment.findFirst({
          where: {
            orderId:
              order.id,
            provider:
              "paypal",
            providerPaymentId:
              body.paymentId,
          },
          select: {
            id: true,
            amountCents:
              true,
            status:
              true,
          },
        });

      if (!payment) {
        return NextResponse.json(
          {
            error:
              "PAYMENT_NOT_FOUND",
          },
          {
            status: 404,
          },
        );
      }

      if (
        payment.amountCents !==
        order.totalCents
      ) {
        return NextResponse.json(
          {
            error:
              "PAYMENT_AMOUNT_MISMATCH",
          },
          {
            status: 400,
          },
        );
      }

      if (
        payment.status ===
        "SUCCEEDED"
      ) {
        return NextResponse.json({
          ok: true,
          reused: true,
          provider:
            "paypal",
          paymentId:
            body.paymentId,
        });
      }

      await provider.capturePayment(
        body.paymentId,
        `paypal-capture:${body.referenceId}:${body.paymentId}`,
      );

      return NextResponse.json({
        ok: true,
        provider:
          "paypal",
        paymentId:
          body.paymentId,
      });
    }

    const walletDeposit = await db.walletDeposit.findFirst({
      where: { id: body.referenceId, userId: user.id },
      select: { id: true, provider: true, providerPaymentId: true, status: true, amountCents: true, currency: true },
    });

    if (walletDeposit) {
      if (walletDeposit.provider !== "paypal") {
        return NextResponse.json({ error: "PAYMENT_PROVIDER_MISMATCH" }, { status: 409 });
      }
      if (walletDeposit.status === "REFUNDED") {
        return NextResponse.json({ error: "PAYMENT_ALREADY_REFUNDED" }, { status: 409 });
      }
      // The capture request must refer to the exact provider order created for
      // this deposit. Never allow a browser-supplied ID to select another payment.
      if (!walletDeposit.providerPaymentId) {
        return NextResponse.json({ error: "PAYMENT_NOT_READY" }, { status: 409 });
      }
      if (walletDeposit.providerPaymentId !== body.paymentId) {
        return NextResponse.json({ error: "PAYMENT_ID_MISMATCH" }, { status: 409 });
      }
      if (walletDeposit.amountCents < 100) {
        return NextResponse.json({ error: "PAYMENT_AMOUNT_INVALID" }, { status: 400 });
      }

      if (walletDeposit.status === "COMPLETED") {
        const existingTransaction = await db.walletTransaction.findFirst({
          where: {
            referenceType: "WALLET_DEPOSIT",
            referenceId: walletDeposit.id,
            type: "DEPOSIT",
          },
          select: { id: true },
        });
        if (existingTransaction) {
          return NextResponse.json({
            ok: true,
            reused: true,
            provider: "paypal",
            paymentId: body.paymentId,
            depositStatus: "COMPLETED",
          });
        }
        // Do not auto-credit a row marked completed without a ledger entry:
        // its balance history is ambiguous and must be reconciled explicitly.
        return NextResponse.json(
          { error: "WALLET_DEPOSIT_LEDGER_INCONSISTENT" },
          { status: 409 },
        );
      }

      const captured = await provider.capturePayment(
        body.paymentId,
        `paypal-capture:${body.referenceId}:${body.paymentId}`,
      );

      if (
        captured.paymentId !== walletDeposit.providerPaymentId ||
        captured.amountCents !== walletDeposit.amountCents ||
        captured.currency.toUpperCase() !== walletDeposit.currency.toUpperCase()
      ) {
        return NextResponse.json({ error: "PAYMENT_AMOUNT_MISMATCH" }, { status: 409 });
      }

      const providerReferences = [captured.customId, captured.referenceId].filter(
        (value): value is string => Boolean(value),
      );
      if (providerReferences.some((value) => value !== walletDeposit.id)) {
        return NextResponse.json({ error: "PAYMENT_REFERENCE_MISMATCH" }, { status: 409 });
      }

      const settlement = await settleWalletDepositAfterCapture(
        user.id,
        walletDeposit.id,
        captured,
      );

      return NextResponse.json({
        ok: true,
        provider: "paypal",
        paymentId: body.paymentId,
        depositStatus: settlement.status,
        walletCredited: settlement.status === "COMPLETED",
        reused: settlement.reused,
      });
    }

    const apiAccessPurchase = await db.apiAccessPurchase.findFirst({
      where: { id: body.referenceId, userId: user.id },
      select: { id: true, provider: true, providerPaymentId: true, status: true, amountCents: true },
    });

    if (apiAccessPurchase) {
      if (apiAccessPurchase.provider !== "paypal") {
        return NextResponse.json({ error: "PAYMENT_PROVIDER_MISMATCH" }, { status: 409 });
      }
      if (apiAccessPurchase.status === "SUCCEEDED") {
        return NextResponse.json({ ok: true, reused: true, provider: "paypal", paymentId: body.paymentId });
      }
      if (apiAccessPurchase.providerPaymentId !== body.paymentId) {
        return NextResponse.json({ error: "PAYMENT_NOT_FOUND" }, { status: 404 });
      }
      if (apiAccessPurchase.amountCents !== 1000) {
        return NextResponse.json({ error: "PAYMENT_AMOUNT_MISMATCH" }, { status: 400 });
      }
      await provider.capturePayment(
        body.paymentId,
        `paypal-capture:${body.referenceId}:${body.paymentId}`,
      );
      return NextResponse.json({ ok: true, provider: "paypal", paymentId: body.paymentId });
    }

    const subscription =
      await db.vipSubscription.findFirst({
        where: {
          id:
            body.referenceId,
          userId:
            user.id,
        },
        select: {
          id: true,
          provider: true,
          paymentId: true,
          status: true,
          plan: {
            select: {
              priceCents:
                true,
            },
          },
          purchase: true,
        },
      });

    if (!subscription) {
      return NextResponse.json(
        {
          error:
            "PAYMENT_REFERENCE_NOT_FOUND",
        },
        {
          status: 404,
        },
      );
    }

    if (
      subscription.provider !==
      "paypal"
    ) {
      return NextResponse.json(
        {
          error:
            "PAYMENT_PROVIDER_MISMATCH",
        },
        {
          status: 409,
        },
      );
    }

    if (
      subscription.status ===
      "ACTIVE"
    ) {
      return NextResponse.json({
        ok: true,
        reused: true,
        provider:
          "paypal",
        paymentId:
          body.paymentId,
      });
    }

    if (
      !subscription.purchase ||
      subscription.purchase.providerPaymentId !==
        body.paymentId
    ) {
      return NextResponse.json(
        {
          error:
            "PAYMENT_NOT_FOUND",
        },
        {
          status: 404,
        },
      );
    }

    /*
     * The amount is the one stored when this checkout was created. It is not
     * compared with the current catalog price: an admin editing a plan while a
     * payment is open must not stop that payment from being captured. The
     * provider's real charge is verified against this stored amount when the
     * webhook activates the subscription.
     */

    await provider.capturePayment(
        body.paymentId,
        `paypal-capture:${body.referenceId}:${body.paymentId}`,
      );

    return NextResponse.json({
      ok: true,
      provider:
        "paypal",
      paymentId:
        body.paymentId,
    });
  } catch (error) {
    if (
      error instanceof
      z.ZodError
    ) {
      return NextResponse.json(
        {
          error:
            "INVALID_CAPTURE_REQUEST",
        },
        {
          status: 400,
        },
      );
    }

    const message =
      publicErrorCode(error, "PAYMENT_CAPTURE_FAILED");

    const status =
      message === "UNAUTHORIZED"
        ? 401
        : message === "PAYPAL_NOT_CONFIGURED" ||
            message === "WALLET_BALANCE_CHANGED" ||
            message === "WALLET_NOT_FOUND"
          ? 503
          : 400;

    return NextResponse.json(
      {
        error:
          message ===
            "PAYMENT_CAPTURE_NOT_SUPPORTED" ||
          message ===
            "PAYPAL_CAPTURE_NOT_COMPLETED"
            ? message
            : "PAYMENT_CAPTURE_FAILED",
      },
      {
        status,
      },
    );
  }
}
