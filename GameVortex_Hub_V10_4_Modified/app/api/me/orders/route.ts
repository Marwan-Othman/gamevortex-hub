import { NextRequest, NextResponse } from "next/server";
import {
  DigitalKeyStatus,
  Prisma,
  ProductKind,
  SourceStatus,
} from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import {
  guardMutation,
  guardRead,
} from "@/lib/api";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().cuid(),
        quantity: z
          .number()
          .int()
          .min(1)
          .max(10),
      }),
    )
    .min(1)
    .max(20),

  idempotencyKey: z
    .string()
    .min(16)
    .max(100),
});

export async function GET(
  request: NextRequest,
) {
  const blocked = await guardRead(
    request,
    "orders:read",
  );

  if (blocked) {
    return blocked;
  }

  try {
    const user = await requireUser();

    const orders =
      await db.order.findMany({
        where: {
          userId: user.id,
        },

        include: {
          items: {
            include: {
              product: true,
            },
          },

          payments: true,
        },

        orderBy: {
          createdAt: "desc",
        },

        take: 50,
      });

    return NextResponse.json(
      orders,
    );
  } catch {
    return NextResponse.json(
      {
        error: "UNAUTHORIZED",
      },
      {
        status: 401,
      },
    );
  }
}

export async function POST(
  request: NextRequest,
) {
  const blocked =
    await guardMutation(
      request,
      "orders:create",
      10,
    );

  if (blocked) {
    return blocked;
  }

  try {
    const user =
      await requireUser();

    const body =
      createSchema.parse(
        await request.json(),
      );

    /*
     * Idempotency:
     * يمنع إنشاء نفس الطلب أكثر
     * من مرة.
     */
    const existing =
      await db.order.findUnique({
        where: {
          idempotencyKey:
            body.idempotencyKey,
        },
      });

    if (existing) {
      if (
        existing.userId !==
        user.id
      ) {
        return NextResponse.json(
          {
            error:
              "IDEMPOTENCY_CONFLICT",
          },
          {
            status: 409,
          },
        );
      }

      return NextResponse.json(
        existing,
      );
    }

    /*
     * دمج العناصر التي لها نفس
     * productId.
     */
    const quantities =
      new Map<
        string,
        number
      >();

    for (const item of body.items) {
      quantities.set(
        item.productId,
        (quantities.get(
          item.productId,
        ) ?? 0) +
          item.quantity,
      );
    }

    const items =
      Array.from(
        quantities.entries(),
      ).map(
        ([
          productId,
          quantity,
        ]) => ({
          productId,
          quantity,
        }),
      );

    /*
     * الحد الأقصى للكمية لكل منتج.
     */
    if (
      items.some(
        (item) =>
          item.quantity >
          10,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "PRODUCT_QUANTITY_LIMIT_EXCEEDED",
        },
        {
          status: 400,
        },
      );
    }

    /*
     * جلب المنتجات التي يستطيع
     * نظام المتجر الحالي بيعها.
     *
     * لا نستخدم OR هنا حتى لا يحصل
     * تعارض TypeScript مع Prisma.
     * فحص المخزون والمفاتيح يتم
     * بعد جلب المنتجات.
     */
    const products =
      await db.gameProduct.findMany({
        where: {
          id: {
            in: items.map(
              (item) =>
                item.productId,
            ),
          },

          active: true,

          supplierVerified:
            true,

          kind:
            ProductKind.GAME_KEY,

          deliveryType:
            "CODE",

          game: {
            published: true,

            sourceStatus: {
              in: [
                SourceStatus.VERIFIED,
                SourceStatus.OFFICIAL_SOURCE,
              ],
            },
          },
        },

        include: {
          game: true,

          /*
           * نجلب المفاتيح المتاحة
           * حتى نعرف هل المنتج لديه
           * كمية كافية للتسليم.
           *
           * لا يتم إرسال الأكواد نفسها.
           */
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
      });

    /*
     * يجب العثور على جميع المنتجات
     * المطلوبة.
     */
    if (
      products.length !==
      items.length
    ) {
      return NextResponse.json(
        {
          error:
            "PRODUCT_NOT_AVAILABLE_FOR_SALE",
        },
        {
          status: 404,
        },
      );
    }

    const productsById =
      new Map(
        products.map(
          (product) => [
            product.id,
            product,
          ],
        ),
      );

    /*
     * لا نسمح بخلط عملات مختلفة
     * داخل الطلب نفسه.
     */
    const currencies =
      new Set(
        products.map(
          (product) =>
            product.currency,
        ),
      );

    if (
      currencies.size !== 1
    ) {
      return NextResponse.json(
        {
          error:
            "MIXED_CURRENCY_NOT_SUPPORTED",
        },
        {
          status: 400,
        },
      );
    }

    let subtotalCents = 0;

    for (const item of items) {
      const product =
        productsById.get(
          item.productId,
        );

      if (!product) {
        return NextResponse.json(
          {
            error:
              "PRODUCT_NOT_FOUND",
          },
          {
            status: 404,
          },
        );
      }

      /*
       * إذا كان المنتج لديه inventory
       * صريح، نتحقق من الكمية.
       */
      if (
        product.inventory !==
          null &&
        product.inventory <
          item.quantity
      ) {
        return NextResponse.json(
          {
            error:
              `OUT_OF_STOCK:${product.sku}`,
          },
          {
            status: 409,
          },
        );
      }

      /*
       * إذا كان المنتج يعتمد على
       * المفاتيح الرقمية، يجب أن يكون
       * هناك عدد كافٍ من المفاتيح
       * المتاحة.
       *
       * ملاحظة:
       * هذا فحص قبل إنشاء الطلب.
       * الحجز النهائي للمفتاح يجب أن
       * يحدث في مسار الدفع/التسليم
       * داخل transaction ذرية.
       */
      if (
        product.digitalKeys.length <
        item.quantity
      ) {
        return NextResponse.json(
          {
            error:
              `DIGITAL_KEYS_OUT_OF_STOCK:${product.sku}`,
          },
          {
            status: 409,
          },
        );
      }

      subtotalCents +=
        product.priceCents *
        item.quantity;
    }

    const currency =
      products[0]?.currency;

    if (!currency) {
      return NextResponse.json(
        {
          error:
            "PRODUCT_NOT_FOUND",
        },
        {
          status: 404,
        },
      );
    }

    /*
     * إنشاء الطلب.
     *
     * لا نخصم المخزون هنا لأن
     * الدفع لم ينجح بعد.
     */
    const order =
      await db.$transaction(
        async (transaction) => {
          return transaction.order.create(
            {
              data: {
                userId:
                  user.id,

                subtotalCents,

                totalCents:
                  subtotalCents,

                currency,

                idempotencyKey:
                  body.idempotencyKey,

                items: {
                  create:
                    items.map(
                      (item) => {
                        const product =
                          productsById.get(
                            item.productId,
                          );

                        if (
                          !product
                        ) {
                          throw new Error(
                            "PRODUCT_NOT_FOUND",
                          );
                        }

                        return {
                          productId:
                            item.productId,

                          quantity:
                            item.quantity,

                          unitPriceCents:
                            product.priceCents,
                        };
                      },
                    ),
                },
              },

              include: {
                items: true,
              },
            },
          );
        },
      );

    return NextResponse.json(
      order,
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
            "INVALID_ORDER",

          details:
            error.flatten(),
        },
        {
          status: 400,
        },
      );
    }

    if (
      error instanceof
        Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        {
          error:
            "ORDER_ALREADY_EXISTS",
        },
        {
          status: 409,
        },
      );
    }

    console.error(
      "POST /api/me/orders error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "ORDER_FAILED",
      },
      {
        status: 400,
      },
    );
  }
}
