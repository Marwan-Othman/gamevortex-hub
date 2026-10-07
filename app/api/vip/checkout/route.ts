import {
  createHash,
  randomUUID,
} from "node:crypto";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  PaymentStatus,
  Prisma,
  VipSubscriptionEventType,
  VipSubscriptionStatus,
} from "@prisma/client";

import { z } from "zod";

import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import {
  ConfiguredPaymentProvider,
} from "@/lib/payments";
import {
  getPurchasableVipPlan,
} from "@/lib/vip-plans";

export const runtime = "nodejs";

export const dynamic =
  "force-dynamic";

const checkoutSchema =
  z.object({
    planCode: z
      .string()
      .trim()
      .min(1)
      .max(32),

    idempotencyKey: z
      .string()
      .trim()
      .min(16)
      .max(100),
  });

function buildReturnUrl(
  subscriptionId: string,
): string {
  const origin =
    process.env.APP_ORIGIN?.trim();

  if (!origin) {
    throw new Error(
      "APP_ORIGIN_NOT_CONFIGURED",
    );
  }

  try {
    return new URL(
      `/payment/return?target=vip&reference=${encodeURIComponent(
        subscriptionId,
      )}`,
      origin,
    ).toString();
  } catch {
    throw new Error(
      "INVALID_APP_ORIGIN",
    );
  }
}

function buildPendingPaymentId(): string {
  return `pending_vip_${randomUUID()}`;
}

function safeCheckoutUrl(
  value: unknown,
): string | undefined {
  if (
    typeof value !== "string"
  ) {
    return undefined;
  }

  if (
    !value.startsWith("https://")
  ) {
    return undefined;
  }

  return value;
}

function metadataWithCheckoutKey(
  metadata:
    | Prisma.JsonValue
    | null
    | undefined,
  idempotencyKey: string,
) {
  const base =
    metadata &&
    typeof metadata ===
      "object" &&
    !Array.isArray(metadata)
      ? metadata
      : {};

  return {
    ...base,
    checkoutIdempotencyKey:
      idempotencyKey,
  };
}

export async function POST(
  request: NextRequest,
) {
  const blocked =
    await guardMutation(
      request,
      "vip:checkout",
      10,
    );

  if (blocked) {
    return blocked;
  }

  try {
    const user =
      await requireUser();

    /*
     * Owner VIP is permanent and must never
     * be purchased through the payment system.
     */
    if (
      user.role ===
      "SUPER_ADMIN"
    ) {
      return NextResponse.json(
        {
          error:
            "OWNER_VIP_DOES_NOT_USE_PAYMENT",
        },
        {
          status: 409,
        },
      );
    }

    const body =
      checkoutSchema.parse(
        await request.json(),
      );

    /*
     * The browser is allowed to send only
     * the plan CODE.
     *
     * It is NOT allowed to send:
     * - price
     * - duration
     * - multiplier
     * - AI credits
     */
    const requestedPlan =
      getPurchasableVipPlan(
        body.planCode,
      );

    if (!requestedPlan) {
      return NextResponse.json(
        {
          error:
            "VIP_PLAN_NOT_PURCHASABLE",
        },
        {
          status: 400,
        },
      );
    }

    const provider =
      new ConfiguredPaymentProvider();

    if (!provider.name) {
      return NextResponse.json(
        {
          error:
            "PAYMENT_PROVIDER_NOT_CONFIGURED",
        },
        {
          status: 503,
        },
      );
    }

    /*
     * The database plan is the authoritative
     * server-side plan.
     *
     * The static catalog is used only to
     * validate that the requested code is
     * a supported purchasable VIP plan.
     */
    const plan =
      await db.vipPlan.findFirst({
        where: {
          code:
            requestedPlan.code,
          active: true,
        },
      });

    if (!plan) {
      return NextResponse.json(
        {
          error:
            "VIP_PLAN_NOT_FOUND",
        },
        {
          status: 404,
        },
      );
    }

    /*
     * Make sure the database plan is still
     * a valid paid plan.
     */
    if (
      plan.priceCents <= 0 ||
      !plan.durationMonths ||
      plan.durationMonths <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "VIP_PLAN_NOT_PURCHASABLE",
        },
        {
          status: 400,
        },
      );
    }

    /*
     * Never allow a second active VIP
     * subscription to be created accidentally.
     *
     * An upgrade/renewal engine will be handled
     * separately so paid time cannot be lost.
     */
    const now =
      new Date();

    const activeSubscription =
      await db.vipSubscription.findFirst({
        where: {
          userId:
            user.id,

          status:
            VipSubscriptionStatus.ACTIVE,

          OR: [
            {
              expiresAt: null,
            },
            {
              expiresAt: {
                gt: now,
              },
            },
          ],
        },

        include: {
          plan: true,
        },

        orderBy: {
          expiresAt: "desc",
        },
      });

    const renewalFromSubscriptionId =
      activeSubscription?.id ?? null;

    /*
     * Idempotency lookup.
     *
     * If the client retries the exact same
     * checkout request, reuse the previous
     * payment instead of creating another one.
     */
    const existingPurchase =
      await db.vipPurchase.findFirst({
        where: {
          userId:
            user.id,

          metadata: {
            path: [
              "checkoutIdempotencyKey",
            ],
            equals:
              body.idempotencyKey,
          },
        },

        include: {
          subscription: {
            include: {
              plan: true,
            },
          },
        },

        orderBy: {
          createdAt: "desc",
        },
      });

    if (existingPurchase) {
      if (
        (existingPurchase.status === PaymentStatus.CREATED ||
          existingPurchase.status === PaymentStatus.REQUIRES_ACTION) &&
        existingPurchase.providerPaymentId.startsWith("pending_vip_")
      ) {
        try {
          const recoveredPayment = await provider.createPayment({
            orderId: existingPurchase.subscriptionId,
            amountCents: existingPurchase.subscription.plan.priceCents,
            currency: existingPurchase.subscription.plan.currency,
            returnUrl: buildReturnUrl(existingPurchase.subscriptionId),
            idempotencyKey: `vip-payment:${existingPurchase.subscriptionId}`,
          });
          const recoveredCheckoutUrl = safeCheckoutUrl(recoveredPayment.checkoutUrl);
          await db.$transaction(async (tx) => {
            await tx.vipPurchase.update({
              where: { id: existingPurchase.id },
              data: {
                providerPaymentId: recoveredPayment.paymentId,
                status:
                  recoveredPayment.status === "CREATED"
                    ? PaymentStatus.CREATED
                    : PaymentStatus.REQUIRES_ACTION,
                metadata: metadataWithCheckoutKey(
                  {
                    checkoutUrl: recoveredCheckoutUrl ?? null,
                    providerStatus: recoveredPayment.status,
                    recoveredAt: new Date().toISOString(),
                  },
                  body.idempotencyKey,
                ),
              },
            });
            await tx.vipSubscription.update({
              where: { id: existingPurchase.subscriptionId },
              data: {
                provider: recoveredPayment.provider,
                paymentId: recoveredPayment.paymentId,
              },
            });
          });
          return NextResponse.json({
            provider: recoveredPayment.provider,
            paymentId: recoveredPayment.paymentId,
            checkoutUrl: recoveredCheckoutUrl,
            status: recoveredPayment.status,
            subscriptionId: existingPurchase.subscriptionId,
            planCode: existingPurchase.subscription.plan.code,
            reused: true,
            recovered: true,
          });
        } catch {
          // Keep the purchase pending so a later retry can safely reuse the provider idempotency key.
        }
      }

      const existingMetadata =
        existingPurchase.metadata &&
        typeof existingPurchase.metadata ===
          "object" &&
        !Array.isArray(
          existingPurchase.metadata,
        )
          ? existingPurchase.metadata
          : null;

      const checkoutUrl =
        safeCheckoutUrl(
          existingMetadata &&
            "checkoutUrl" in
              existingMetadata
            ? existingMetadata.checkoutUrl
            : undefined,
        );

      if (checkoutUrl) {
        return NextResponse.json({
          provider:
            existingPurchase.provider,

          paymentId:
            existingPurchase.providerPaymentId,

          checkoutUrl,

          status:
            existingPurchase.status,

          subscriptionId:
            existingPurchase.subscriptionId,

          planCode:
            existingPurchase.subscription
              .plan.code,

          reused: true,
        });
      }

      /*
       * The same idempotency key already
       * created a checkout, but no reusable
       * checkout URL exists.
       */
      return NextResponse.json(
        {
          error:
            "VIP_CHECKOUT_ALREADY_STARTED",

          subscriptionId:
            existingPurchase.subscriptionId,
        },
        {
          status: 409,
        },
      );
    }

    /*
     * Prevent multiple unfinished VIP
     * checkouts for the same user.
     *
     * A previous failed payment is not included.
     */
    const pendingSubscription =
      await db.vipSubscription.findFirst({
        where: {
          userId:
            user.id,

          status:
            VipSubscriptionStatus.PENDING,

          purchase: {
            status: {
              in: [
                PaymentStatus.CREATED,
                PaymentStatus.REQUIRES_ACTION,
              ],
            },
          },
        },

        include: {
          plan: true,
          purchase: true,
        },

        orderBy: {
          createdAt: "desc",
        },
      });

    if (pendingSubscription) {
      const pendingMetadata =
        pendingSubscription.purchase
          ?.metadata &&
        typeof pendingSubscription.purchase
          .metadata === "object" &&
        !Array.isArray(
          pendingSubscription.purchase
            .metadata,
        )
          ? pendingSubscription.purchase
              .metadata
          : null;

      const checkoutUrl =
        safeCheckoutUrl(
          pendingMetadata &&
            "checkoutUrl" in
              pendingMetadata
            ? pendingMetadata.checkoutUrl
            : undefined,
        );

      if (checkoutUrl) {
        return NextResponse.json({
          provider:
            pendingSubscription.purchase
              ?.provider,

          paymentId:
            pendingSubscription.purchase
              ?.providerPaymentId,

          checkoutUrl,

          status:
            pendingSubscription.purchase
              ?.status,

          subscriptionId:
            pendingSubscription.id,

          planCode:
            pendingSubscription.plan
              .code,

          reused: true,
        });
      }

      return NextResponse.json(
        {
          error:
            "VIP_CHECKOUT_ALREADY_STARTED",

          subscriptionId:
            pendingSubscription.id,
        },
        {
          status: 409,
        },
      );
    }

    /*
     * Create the VIP subscription first.
     *
     * The purchase uses a temporary local
     * payment ID until the real provider
     * payment ID is returned.
     */
    const pendingPaymentId =
      buildPendingPaymentId();

    const created =
      await db.$transaction(
        async (tx) => {
          // Re-check inside a serializable transaction so two concurrent
          // checkout requests cannot both pass the earlier availability check.
          const concurrentActiveSubscription =
            await tx.vipSubscription.findFirst({
              where: {
                userId: user.id,
                status: VipSubscriptionStatus.ACTIVE,
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gt: new Date() } },
                ],
              },
              select: {
                id: true,
                plan: {
                  select: {
                    code: true,
                  },
                },
                expiresAt: true,
              },
            });

          if (
            concurrentActiveSubscription &&
            !renewalFromSubscriptionId
          ) {
            throw new Error("VIP_ALREADY_ACTIVE");
          }

          if (
            renewalFromSubscriptionId &&
            concurrentActiveSubscription &&
            concurrentActiveSubscription.id !==
              renewalFromSubscriptionId
          ) {
            throw new Error("VIP_CHECKOUT_CONFLICT_RETRY");
          }

          const subscription =
            await tx.vipSubscription.create({
              data: {
                userId:
                  user.id,

                planId:
                  plan.id,

                status:
                  VipSubscriptionStatus.PENDING,

                provider:
                  provider.name,

              },
            });

          const metadata =
            metadataWithCheckoutKey(
              {
                planCode:
                  plan.code,

                planPriceCents:
                  plan.priceCents,

                planCurrency:
                  plan.currency,

                requestedAt:
                  new Date().toISOString(),

                renewalFromSubscriptionId:
                  renewalFromSubscriptionId,
              },
              body.idempotencyKey,
            );

          const purchase =
            await tx.vipPurchase.create({
              data: {
                userId:
                  user.id,

                subscriptionId:
                  subscription.id,

                amountCents:
                  plan.priceCents,

                currency:
                  plan.currency,

                provider:
                  provider.name,

                providerPaymentId:
                  pendingPaymentId,

                status:
                  PaymentStatus.CREATED,

                metadata,
              },
            });

          await tx.vipSubscriptionEvent.create({
            data: {
              subscriptionId:
                subscription.id,

              type:
                VipSubscriptionEventType.CREATED,

              provider:
                provider.name,

              metadata: {
                planCode:
                  plan.code,

                amountCents:
                  plan.priceCents,

                currency:
                  plan.currency,

                checkoutIdempotencyKey:
                  body.idempotencyKey,

                renewalFromSubscriptionId:
                  renewalFromSubscriptionId,
              },
            },
          });

          return {
            subscription,
            purchase,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

    let payment;

    try {
      /*
       * The provider receives only the trusted
       * server-side amount and currency.
       *
       * It receives the VIP subscription ID
       * as its orderId/reference ID.
       */
      payment =
        await provider.createPayment({
          orderId:
            created.subscription.id,

          amountCents:
            plan.priceCents,

          currency:
            plan.currency,

          returnUrl:
            buildReturnUrl(
              created.subscription.id,
            ),
          idempotencyKey: `vip-payment:${body.idempotencyKey}`,
        });
    } catch (error) {
      /*
       * Provider creation failed.
       *
       * Mark the subscription/payment as
       * failed so the user can safely start
       * a new checkout.
       */
      await db.$transaction(
        async (tx) => {
          await tx.vipPurchase.update({
            where: {
              id:
                created.purchase.id,
            },

            data: {
              status:
                PaymentStatus.FAILED,

              metadata:
                metadataWithCheckoutKey(
                  {
                    error:
                      error instanceof
                      Error
                        ? error.message
                        : "PAYMENT_PROVIDER_ERROR",

                    failedAt:
                      new Date().toISOString(),
                  },
                  body.idempotencyKey,
                ),
            },
          });

          await tx.vipSubscription.update({
            where: {
              id:
                created.subscription.id,
            },

            data: {
              status:
                VipSubscriptionStatus.PAYMENT_FAILED,
            },
          });

          await tx.vipSubscriptionEvent.create({
            data: {
              subscriptionId:
                created.subscription.id,

              type:
                VipSubscriptionEventType.PAYMENT_FAILED,

              provider:
                provider.name,

              metadata: {
                reason:
                  error instanceof
                  Error
                    ? error.message
                    : "PAYMENT_PROVIDER_ERROR",
              },
            },
          });
        },
      );

      throw error;
    }

    const checkoutUrl =
      safeCheckoutUrl(
        payment.checkoutUrl,
      );

    /*
     * Persist the real provider payment ID
     * and checkout URL.
     */
    const updated =
      await db.$transaction(
        async (tx) => {
          const purchase =
            await tx.vipPurchase.update({
              where: {
                id:
                  created.purchase.id,
              },

              data: {
                providerPaymentId:
                  payment.paymentId,

                status:
                  payment.status ===
                  "CREATED"
                    ? PaymentStatus.CREATED
                    : PaymentStatus.REQUIRES_ACTION,

                metadata:
                  metadataWithCheckoutKey(
                    {
                      checkoutUrl:
                        checkoutUrl ??
                        null,

                      providerStatus:
                        payment.status,

                      createdAt:
                        new Date().toISOString(),
                    },
                    body.idempotencyKey,
                  ),
              },
            });

          const subscription =
            await tx.vipSubscription.update({
              where: {
                id:
                  created.subscription.id,
              },

              data: {
                provider:
                  payment.provider,

                paymentId:
                  payment.paymentId,
              },
            });

          return {
            purchase,
            subscription,
          };
        },
      );

    /*
     * Return only provider information needed
     * by the client.
     *
     * Plan price and duration remain server-side
     * authoritative values.
     */
    return NextResponse.json(
      {
        provider:
          payment.provider,

        paymentId:
          payment.paymentId,

        checkoutUrl:
          checkoutUrl,

        status:
          payment.status,

        subscriptionId:
          updated.subscription.id,

        planCode:
          plan.code,

        reused: false,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return NextResponse.json(
        {
          error: "VIP_CHECKOUT_CONFLICT_RETRY",
        },
        {
          status: 409,
        },
      );
    }

    if (
      error instanceof
      z.ZodError
    ) {
      return NextResponse.json(
        {
          error:
            "INVALID_VIP_CHECKOUT_REQUEST",
        },
        {
          status: 400,
        },
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : "VIP_CHECKOUT_FAILED";

    const knownErrors =
      new Set([
        "UNAUTHORIZED",
        "OWNER_VIP_DOES_NOT_USE_PAYMENT",
        "VIP_PLAN_NOT_PURCHASABLE",
        "VIP_PLAN_NOT_FOUND",
        "VIP_ALREADY_ACTIVE",
        "VIP_CHECKOUT_CONFLICT_RETRY",
        "VIP_CHECKOUT_ALREADY_STARTED",
        "PAYMENT_PROVIDER_NOT_CONFIGURED",
        "APP_ORIGIN_NOT_CONFIGURED",
        "INVALID_APP_ORIGIN",
        "RETURN_URL_NOT_ALLOWED",
        "UNSUPPORTED_CURRENCY",
        "INVALID_PAYMENT_AMOUNT",
        "PAYMENT_PROVIDER_ERROR",
        "PAYPAL_NOT_CONFIGURED",
        "PAYPAL_AUTH_FAILED",
        "PAYPAL_ERROR",
      ]);

    /*
     * لا نكشف رسالة الخطأ الحقيقية للمستخدم (قد تحتوي
     * على تفاصيل داخلية من مزود الدفع)، لكن نسجّلها هنا
     * بسجلات السيرفر (Vercel Runtime Logs) حتى يمكن
     * تشخيص أي خطأ غير متوقع لاحقًا دون تخمين.
     */
    if (!knownErrors.has(message)) {
      console.error(
        "[vip-checkout] unexpected error:",
        message,
      );
    }

    const status =
      message === "UNAUTHORIZED"
        ? 401
        : message ===
            "VIP_ALREADY_ACTIVE" ||
          message ===
            "VIP_CHECKOUT_ALREADY_STARTED"
          ? 409
          : knownErrors.has(message)
            ? 400
            : 500;

    return NextResponse.json(
      {
        error:
          knownErrors.has(message)
            ? message
            : "VIP_CHECKOUT_FAILED",
      },
      {
        status,
      },
    );
  }
}
