import { NextRequest, NextResponse } from "next/server";
import {
  DeliveryType,
  DigitalKeyStatus,
  ProductKind,
  SourceStatus,
} from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import {
  ConfiguredPaymentProvider,
} from "@/lib/payments";
import {
  logSystemError,
} from "@/lib/observability";

function checkoutUrlFrom(
  value: unknown,
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return undefined;
  }

  const url =
    (
      value as Record<
        string,
        unknown
      >
    ).checkoutUrl;

  return typeof url === "string" &&
    url.startsWith("https://")
    ? url
    : undefined;
}

function checkoutReturnUrl(
  orderId: string,
) {
  const origin =
    process.env.APP_ORIGIN;

  if (!origin) {
    return "/orders?checkout=complete";
  }

  try {
    return new URL(
      `/payment/return?target=orders&reference=${encodeURIComponent(
        orderId,
      )}`,
      origin,
    ).toString();
  } catch {
    return "/orders?checkout=complete";
  }
}

function isSellableGameKey(
  item: {
    product: {
      active: boolean;
      supplierVerified: boolean;
      kind: ProductKind;
      deliveryType: DeliveryType;
      inventory: number | null;

      game: {
        published: boolean;
        sourceStatus: SourceStatus;
      };

      digitalKeys: {
        id: string;
      }[];
    };
  },
  quantity: number,
) {
  const {
    product,
  } = item;

  const validSource =
    product.game.sourceStatus ===
      SourceStatus.VERIFIED ||
    product.game.sourceStatus ===
      SourceStatus.OFFICIAL_SOURCE;

  const enoughInventory =
    product.inventory !== null &&
    product.inventory >= quantity;

  const enoughDigitalKeys =
    product.digitalKeys.length >=
    quantity;

  return (
    product.active &&
    product.supplierVerified &&
    product.kind ===
      ProductKind.GAME_KEY &&
    product.deliveryType ===
      DeliveryType.CODE &&
    product.game.published &&
    validSource &&
    (enoughInventory ||
      enoughDigitalKeys)
  );
}

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  const blocked =
    await guardMutation(
      request,
      "orders:checkout",
      10,
    );

  if (blocked) {
    return blocked;
  }

  let userId:
    | string
    | undefined;

  try {
    const user =
      await requireUser();

    userId = user.id;

    const {
      id: rawId,
    } = await params;

    const id =
      z.string().cuid().parse(
        rawId,
      );

    const order =
      await db.order.findFirst({
        where: {
          id,
          userId: user.id,
        },

        include: {
          items: {
            include: {
              product: {
                include: {
                  game: true,

                  digitalKeys: {
                    where: {
                      status:
                        DigitalKeyStatus.AVAILABLE,
                    },

                    select: {
                      id: true,
                    },

                    take: 10,
                  },
                },
              },
            },
          },

          payments: true,
        },
      });

    if (!order) {
      return NextResponse.json(
        {
          error:
            "ORDER_NOT_FOUND",
        },
        {
          status: 404,
        },
      );
    }

    if (
      order.paymentStatus !==
        "CREATED" ||
      order.status !==
        "PENDING"
    ) {
      return NextResponse.json(
        {
          error:
            "ORDER_NOT_PAYABLE",
        },
        {
          status: 409,
        },
      );
    }

    if (!order.items.length) {
      return NextResponse.json(
        {
          error:
            "ORDER_EMPTY",
        },
        {
          status: 409,
        },
      );
    }

    /*
     * تجميع الكميات حسب المنتج.
     */
    const quantities =
      new Map<
        string,
        number
      >();

    for (const item of order.items) {
      quantities.set(
        item.productId,
        (
          quantities.get(
            item.productId,
          ) ?? 0
        ) + item.quantity,
      );
    }

    /*
     * التحقق من كل منتج.
     */
    for (const [
      productId,
      quantity,
    ] of quantities) {
      const item =
        order.items.find(
          (entry) =>
            entry.productId ===
            productId,
        );

      if (!item) {
        return NextResponse.json(
          {
            error:
              "ORDER_PRODUCT_NOT_FOUND",
          },
          {
            status: 404,
          },
        );
      }

      const product =
        item.product;

      if (
        !isSellableGameKey(
          {
            product,
          },
          quantity,
        )
      ) {
        return NextResponse.json(
          {
            error:
              "ORDER_ITEM_NOT_AVAILABLE_FOR_SALE",
          },
          {
            status: 409,
          },
        );
      }

      /*
       * إذا كان المنتج يعتمد على
       * المفاتيح الرقمية، يجب التأكد
       * من وجود العدد المطلوب.
       */
      if (
        product.digitalKeys
          .length <
        quantity
      ) {
        return NextResponse.json(
          {
            error:
              "DIGITAL_KEYS_OUT_OF_STOCK",
          },
          {
            status: 409,
          },
        );
      }
    }

    const configuredProvider =
      (
        process.env
          .PAYMENT_PROVIDER || ""
      ).toLowerCase();

    if (!configuredProvider) {
      await logSystemError(
        "orders:checkout",
        new Error(
          "PAYMENT_PROVIDER_NOT_CONFIGURED",
        ),
        {
          statusCode: 503,
          userId,
        },
      );

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
     * إذا كان هناك Checkout سابق
     * صالح لنفس الطلب، نعيد استخدامه
     * بدل إنشاء جلسة دفع جديدة.
     */
    const existingPayment =
      order.payments.find(
        (payment) => {
          const url =
            checkoutUrlFrom(
              payment.rawEvent,
            );

          return (
            payment.provider ===
              configuredProvider &&
            payment.status ===
              "REQUIRES_ACTION" &&
            Boolean(url)
          );
        },
      );

    if (existingPayment) {
      return NextResponse.json({
        provider:
          existingPayment.provider,

        paymentId:
          existingPayment.providerPaymentId,

        checkoutUrl:
          checkoutUrlFrom(
            existingPayment.rawEvent,
          ),

        status:
          existingPayment.status,

        reused: true,
      });
    }

    /*
     * إنشاء جلسة الدفع.
     */
    const provider =
      new ConfiguredPaymentProvider();

    const payment =
      await provider.createPayment(
        {
          orderId:
            order.id,

          amountCents:
            order.totalCents,

          currency:
            order.currency,

          returnUrl:
            checkoutReturnUrl(
              order.id,
            ),
          idempotencyKey: `order-payment:${order.id}`,
        },
      );

    /*
     * تسجيل الدفع وربطه بالطلب
     * داخل transaction واحدة.
     */
    await db.$transaction(
      async (transaction) => {
        await transaction.payment.upsert(
          {
            where: {
              provider_providerPaymentId:
                {
                  provider:
                    payment.provider,

                  providerPaymentId:
                    payment.paymentId,
                },
            },

            create: {
              orderId:
                order.id,

              provider:
                payment.provider,

              providerPaymentId:
                payment.paymentId,

              status:
                payment.status,

              amountCents:
                order.totalCents,

              currency:
                order.currency,

              rawEvent:
                payment.checkoutUrl
                  ? {
                      checkoutUrl:
                        payment.checkoutUrl,
                    }
                  : undefined,
            },

            update: {
              status:
                payment.status,

              rawEvent:
                payment.checkoutUrl
                  ? {
                      checkoutUrl:
                        payment.checkoutUrl,
                    }
                  : undefined,
            },
          },
        );

        await transaction.order.update(
          {
            where: {
              id: order.id,
            },

            data: {
              paymentProvider:
                payment.provider,

              paymentStatus:
                payment.status,
            },
          },
        );
      },
    );

    return NextResponse.json(
      payment,
      {
        status: 201,
      },
    );
  } catch (error) {
    if (
      error instanceof
      z.ZodError
    ) {
      return NextResponse.json(
        {
          error:
            "INVALID_ORDER_ID",
        },
        {
          status: 400,
        },
      );
    }

    if (
      error instanceof Error &&
      error.message ===
        "PAYMENT_PROVIDER_NOT_CONFIGURED"
    ) {
      await logSystemError(
        "orders:checkout",
        error,
        {
          statusCode: 503,
          userId,
        },
      );

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

    if (
      error instanceof Error &&
      error.message !==
        "UNAUTHORIZED"
    ) {
      await logSystemError(
        "orders:checkout",
        error,
        {
          statusCode: 400,
          userId,
        },
      );
    }

    return NextResponse.json(
      {
        error:
          "CHECKOUT_FAILED",
      },
      {
        status: 400,
      },
    );
  }
}
