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
import { calculateProductRewardPoints, creditPointsInTransaction } from "@/lib/points";
import { applyVipPointsMultiplier, getVipPointsMultiplierInTransaction } from "@/lib/vip";

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

        select: {
          id: true,
          status: true,
          subtotalCents: true,
          totalCents: true,
          currency: true,
          paymentStatus: true,
          paymentProvider: true,
          providerOrderId: true,
          createdAt: true,
          updatedAt: true,
          items: {
            select: {
              id: true,
              productId: true,
              quantity: true,
              unitPriceCents: true,
              product: {
                select: {
                  id: true,
                  sku: true,
                  title: true,
                  description: true,
                  priceCents: true,
                  currency: true,
                  kind: true,
                  deliveryType: true,
                  region: true,
                  country: true,
                  denominationCents: true,
                  redemptionInstructions: true,
                },
              },
            },
          },
          payments: {
            select: {
              id: true,
              provider: true,
              status: true,
              amountCents: true,
              currency: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: { createdAt: "asc" },
          },
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
          const created = await transaction.order.create(
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

          if (subtotalCents === 0) {
            for (const item of created.items) {
              const product = productsById.get(item.productId);
              if (!product) throw new Error("PRODUCT_NOT_FOUND");

              if (product.inventory !== null) {
                const stock = await transaction.gameProduct.updateMany({
                  where: { id: product.id, inventory: { gte: item.quantity } },
                  data: { inventory: { decrement: item.quantity } },
                });
                if (stock.count !== 1) throw new Error("OUT_OF_STOCK");
              }

              const available = await transaction.digitalKey.findMany({
                where: { productId: product.id, status: DigitalKeyStatus.AVAILABLE },
                orderBy: { createdAt: "asc" },
                take: item.quantity,
                select: { id: true },
              });
              if (available.length !== item.quantity) throw new Error("DIGITAL_KEYS_OUT_OF_STOCK");
              const delivered = await transaction.digitalKey.updateMany({
                where: { id: { in: available.map((key) => key.id) }, status: DigitalKeyStatus.AVAILABLE },
                data: { status: DigitalKeyStatus.DELIVERED, orderItemId: item.id, deliveredAt: new Date() },
              });
              if (delivered.count !== item.quantity) throw new Error("DIGITAL_KEYS_OUT_OF_STOCK");

              await transaction.entitlement.upsert({
                where: { userId_gameId: { userId: user.id, gameId: product.gameId } },
                create: { userId: user.id, gameId: product.gameId, orderItemId: item.id },
                update: { revokedAt: null, orderItemId: item.id },
              });
            }

            const baseRewardPoints = calculateProductRewardPoints(created.items.map((item) => {
              const product = productsById.get(item.productId);
              if (!product) throw new Error("PRODUCT_NOT_FOUND");
              return {
                quantity: item.quantity,
                unitPriceCents: item.unitPriceCents,
                currency: product.currency,
                rewardPoints: product.rewardPoints,
              };
            }));
            const vipMultiplier = await getVipPointsMultiplierInTransaction(transaction, user.id);
            const rewardPoints = baseRewardPoints > 0
              ? applyVipPointsMultiplier(baseRewardPoints, vipMultiplier)
              : 0;
            await transaction.order.update({
              where: { id: created.id },
              data: { status: "COMPLETED", paymentStatus: "NOT_REQUIRED", paymentProvider: "FREE" },
            });
            if (rewardPoints > 0) {
              await creditPointsInTransaction(transaction, {
                userId: user.id,
                amount: rewardPoints,
                reason: "FREE_STORE_PRODUCT_REWARD",
                sourceId: created.id,
                idempotencyKey: `free-order-points:${created.id}`,
                metadata: { orderId: created.id, rewardPoints },
              });
            }
            return { ...created, status: "COMPLETED" as const, paymentStatus: "NOT_REQUIRED" as const, paymentProvider: "FREE" };
          }

          return created;
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
