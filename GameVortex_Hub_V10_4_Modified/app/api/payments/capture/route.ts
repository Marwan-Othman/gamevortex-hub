import {
  NextRequest,
  NextResponse,
} from "next/server";

import { z } from "zod";

import {
  db,
} from "@/lib/prisma";

import {
  requireUser,
} from "@/lib/auth";

import {
  guardMutation,
} from "@/lib/api";

import {
  ConfiguredPaymentProvider,
} from "@/lib/payments";

export const runtime =
  "nodejs";

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
      );

      return NextResponse.json({
        ok: true,
        provider:
          "paypal",
        paymentId:
          body.paymentId,
      });
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

    if (
      subscription.purchase.amountCents !==
      subscription.plan.priceCents
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

    await provider.capturePayment(
      body.paymentId,
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
      error instanceof Error
        ? error.message
        : "PAYMENT_CAPTURE_FAILED";

    const status =
      message ===
        "UNAUTHORIZED"
        ? 401
        : message ===
            "PAYPAL_NOT_CONFIGURED"
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
