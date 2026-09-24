import { NextRequest, NextResponse } from "next/server";
import {
  DeliveryType,
  ProductKind,
  SourceStatus,
} from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";

export const dynamic = "force-dynamic";

async function getProductId(
  params: Promise<{ id: string }>,
) {
  const { id } = await params;

  return z.string().cuid().parse(id);
}

const updateSchema = z
  .object({
    sku: z.string().trim().min(2).max(120).optional(),

    title: z.string().trim().min(2).max(200).optional(),

    description: z
      .string()
      .trim()
      .max(5000)
      .nullable()
      .optional(),

    priceCents: z
      .number()
      .int()
      .min(0)
      .max(100000000)
      .optional(),

    currency: z
      .string()
      .trim()
      .min(3)
      .max(10)
      .transform((value) => value.toUpperCase())
      .optional(),

    kind: z
      .nativeEnum(ProductKind)
      .optional(),

    deliveryType: z
      .nativeEnum(DeliveryType)
      .optional(),

    inventory: z
      .number()
      .int()
      .min(0)
      .nullable()
      .optional(),

    region: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .optional(),

    country: z
      .string()
      .trim()
      .max(100)
      .nullable()
      .optional(),

    provider: z
      .string()
      .trim()
      .max(200)
      .nullable()
      .optional(),

    sourceUrl: z
      .string()
      .trim()
      .url()
      .max(2000)
      .nullable()
      .optional(),

    redemptionInstructions: z
      .string()
      .trim()
      .max(5000)
      .nullable()
      .optional(),

    active: z.boolean().optional(),

    supplierVerified: z
      .boolean()
      .optional(),

    /**
     * publish=true:
     * ينشر المنتج في متجر المستخدمين.
     *
     * publish=false:
     * يخفي المنتج من متجر المستخدمين.
     */
    publish: z.boolean().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    {
      message: "NO_FIELDS_TO_UPDATE",
    },
  );

function cleanNullable(
  value:
    | string
    | null
    | undefined,
) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  const trimmed = value.trim();

  return trimmed || null;
}

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  },
) {
  const blocked = await guardRead(
    request,
    "admin:products",
    60,
  );

  if (blocked) return blocked;

  try {
    await requireOwner();

    const productId =
      await getProductId(params);

    const product =
      await db.gameProduct.findUnique({
        where: {
          id: productId,
        },

        include: {
          game: {
            select: {
              id: true,
              slug: true,
              titleAr: true,
              titleEn: true,
              coverUrl: true,
              published: true,
              sourceStatus: true,
            },
          },

          digitalKeys: {
            where: {
              status: "AVAILABLE",
            },

            select: {
              id: true,
            },

            take: 1,
          },

          _count: {
            select: {
              orderItems: true,
              digitalKeys: true,
            },
          },
        },
      });

    if (!product) {
      return NextResponse.json(
        {
          success: false,
          error: "PRODUCT_NOT_FOUND",
        },
        {
          status: 404,
        },
      );
    }

    return NextResponse.json({
      success: true,
      data: product,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: "INVALID_PRODUCT_ID",
        },
        {
          status: 400,
        },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: "FORBIDDEN",
      },
      {
        status: 403,
      },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  },
) {
  const blocked = await guardMutation(
    request,
    "admin:products:update",
    20,
  );

  if (blocked) return blocked;

  try {
    const owner =
      await requireOwner();

    const productId =
      await getProductId(params);

    const body =
      updateSchema.parse(
        await request.json(),
      );

    const existing =
      await db.gameProduct.findUnique({
        where: {
          id: productId,
        },

        select: {
          id: true,
          sku: true,
          title: true,
          active: true,
          supplierVerified: true,
          inventory: true,
          kind: true,
          deliveryType: true,

          game: {
            select: {
              published: true,
              sourceStatus: true,
            },
          },

          _count: {
            select: {
              digitalKeys: true,
              orderItems: true,
            },
          },
        },
      });

    if (!existing) {
      return NextResponse.json(
        {
          success: false,
          error: "PRODUCT_NOT_FOUND",
        },
        {
          status: 404,
        },
      );
    }

    if (
      body.sku !== undefined &&
      body.sku !== existing.sku
    ) {
      const duplicate =
        await db.gameProduct.findFirst({
          where: {
            sku: body.sku,
            id: {
              not: productId,
            },
          },

          select: {
            id: true,
          },
        });

      if (duplicate) {
        return NextResponse.json(
          {
            success: false,
            error: "SKU_ALREADY_EXISTS",
          },
          {
            status: 409,
          },
        );
      }
    }

    const data: {
      sku?: string;
      title?: string;
      description?: string | null;
      priceCents?: number;
      currency?: string;
      kind?: ProductKind;
      deliveryType?: DeliveryType;
      inventory?: number | null;
      region?: string | null;
      country?: string | null;
      provider?: string | null;
      sourceUrl?: string | null;
      redemptionInstructions?: string | null;
      active?: boolean;
      supplierVerified?: boolean;
    } = {};

    if (body.sku !== undefined) {
      data.sku = body.sku;
    }

    if (body.title !== undefined) {
      data.title = body.title;
    }

    if (
      body.description !==
      undefined
    ) {
      data.description =
        cleanNullable(
          body.description,
        );
    }

    if (
      body.priceCents !==
      undefined
    ) {
      data.priceCents =
        body.priceCents;
    }

    if (
      body.currency !==
      undefined
    ) {
      data.currency =
        body.currency;
    }

    if (body.kind !== undefined) {
      data.kind = body.kind;
    }

    if (
      body.deliveryType !==
      undefined
    ) {
      data.deliveryType =
        body.deliveryType;
    }

    if (
      body.inventory !==
      undefined
    ) {
      data.inventory =
        body.inventory;
    }

    if (body.region !== undefined) {
      data.region =
        cleanNullable(
          body.region,
        );
    }

    if (
      body.country !==
      undefined
    ) {
      data.country =
        cleanNullable(
          body.country,
        );
    }

    if (
      body.provider !==
      undefined
    ) {
      data.provider =
        cleanNullable(
          body.provider,
        );
    }

    if (
      body.sourceUrl !==
      undefined
    ) {
      data.sourceUrl =
        cleanNullable(
          body.sourceUrl,
        );
    }

    if (
      body.redemptionInstructions !==
      undefined
    ) {
      data.redemptionInstructions =
        cleanNullable(
          body.redemptionInstructions,
        );
    }

    if (
      body.active !==
      undefined
    ) {
      data.active =
        body.active;
    }

    if (
      body.supplierVerified !==
      undefined
    ) {
      data.supplierVerified =
        body.supplierVerified;
    }

    /*
     * النشر من خلال publish=true
     *
     * المنتج الذي يدعم متجر المستخدمين
     * حاليًا يجب أن يكون:
     *
     * GAME_KEY
     * CODE
     * اللعبة منشورة
     * مصدر اللعبة موثق
     * يوجد مفتاح رقمي متاح
     */
    if (body.publish === true) {
      const resultingKind =
        body.kind ??
        existing.kind;

      const resultingDeliveryType =
        body.deliveryType ??
        existing.deliveryType;

      const isDigitalGameKey =
        resultingKind ===
          ProductKind.GAME_KEY &&
        resultingDeliveryType ===
          DeliveryType.CODE;

      if (!isDigitalGameKey) {
        return NextResponse.json(
          {
            success: false,
            error:
              "PRODUCT_TYPE_NOT_SUPPORTED_FOR_MARKETPLACE",
          },
          {
            status: 409,
          },
        );
      }

      if (
        !existing.game.published
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "GAME_NOT_PUBLISHED",
          },
          {
            status: 409,
          },
        );
      }

      const sourceIsVerified =
        existing.game
          .sourceStatus ===
          SourceStatus.VERIFIED ||
        existing.game
          .sourceStatus ===
          SourceStatus.OFFICIAL_SOURCE;

      if (!sourceIsVerified) {
        return NextResponse.json(
          {
            success: false,
            error:
              "GAME_SOURCE_NOT_VERIFIED",
          },
          {
            status: 409,
          },
        );
      }

      if (
        existing._count.digitalKeys <=
        0
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "PRODUCT_HAS_NO_DIGITAL_KEYS",
          },
          {
            status: 409,
          },
        );
      }

      /*
       * النشر يجعل المنتج نشطًا وموثقًا
       * لأن المالك هو صاحب قرار نشر
       * المنتج في متجر GameVortex.
       */
      data.active = true;
      data.supplierVerified = true;
    }

    /*
     * إلغاء النشر:
     * يبقى المنتج في لوحة المالك
     * لكنه يختفي من متجر المستخدمين.
     */
    if (body.publish === false) {
      data.active = false;
    }

    /*
     * حماية إضافية:
     * لا يمكن تفعيل منتج يدويًا مع
     * supplierVerified=false.
     */
    if (
      data.active === true &&
      data.supplierVerified === false
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "SUPPLIER_MUST_BE_VERIFIED_BEFORE_ACTIVATION",
        },
        {
          status: 409,
        },
      );
    }

    /*
     * إذا كان المنتج منشورًا وتم تغيير
     * نوعه أو طريقة التسليم إلى نوع
     * غير مدعوم، نمنع التحديث حتى لا
     * يبقى المنتج ظاهرًا في المتجر
     * بينما نظام الطلب لا يعرف كيف يبيعه.
     */
    if (
      data.active === true
    ) {
      const resultingKind =
        data.kind ??
        existing.kind;

      const resultingDeliveryType =
        data.deliveryType ??
        existing.deliveryType;

      const supportedForSale =
        resultingKind ===
          ProductKind.GAME_KEY &&
        resultingDeliveryType ===
          DeliveryType.CODE;

      if (!supportedForSale) {
        return NextResponse.json(
          {
            success: false,
            error:
              "ACTIVE_PRODUCT_TYPE_NOT_SUPPORTED",
          },
          {
            status: 409,
          },
        );
      }
    }

    const product =
      await db.$transaction(
        async (transaction) => {
          const updated =
            await transaction.gameProduct.update(
              {
                where: {
                  id: productId,
                },

                data,

                include: {
                  game: {
                    select: {
                      id: true,
                      slug: true,
                      titleAr: true,
                      titleEn: true,
                      coverUrl: true,
                      published: true,
                      sourceStatus: true,
                    },
                  },
                },
              },
            );

          await transaction.auditLog.create(
            {
              data: {
                actorUserId:
                  owner.id,

                action:
                  body.publish === true
                    ? "STORE_PRODUCT_PUBLISHED"
                    : body.publish === false
                      ? "STORE_PRODUCT_UNPUBLISHED"
                      : "STORE_PRODUCT_UPDATED",

                entityType:
                  "GameProduct",

                entityId:
                  productId,

                metadata: {
                  previous: {
                    sku: existing.sku,
                    title:
                      existing.title,
                    active:
                      existing.active,
                    supplierVerified:
                      existing.supplierVerified,
                    inventory:
                      existing.inventory,
                  },

                  updatedFields:
                    Object.keys(
                      data,
                    ),

                  publish:
                    body.publish ??
                    null,
                },
              },
            },
          );

          return updated;
        },
      );

    return NextResponse.json({
      success: true,
      data: product,
    });
  } catch (error) {
    if (
      error instanceof
      z.ZodError
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "INVALID_PRODUCT_UPDATE",
          details:
            error.flatten(),
        },
        {
          status: 400,
        },
      );
    }

    console.error(
      "PATCH /api/admin/products/[id] error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "PRODUCT_UPDATE_FAILED",
      },
      {
        status: 400,
      },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  },
) {
  const blocked =
    await guardMutation(
      request,
      "admin:products:delete",
      10,
    );

  if (blocked) return blocked;

  try {
    const owner =
      await requireOwner();

    const productId =
      await getProductId(params);

    const product =
      await db.gameProduct.findUnique(
        {
          where: {
            id: productId,
          },

          select: {
            id: true,
            sku: true,
            title: true,
            active: true,

            _count: {
              select: {
                orderItems: true,
                digitalKeys: true,
              },
            },
          },
        },
      );

    if (!product) {
      return NextResponse.json(
        {
          success: false,
          error:
            "PRODUCT_NOT_FOUND",
        },
        {
          status: 404,
        },
      );
    }

    if (
      product._count.orderItems >
      0
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "PRODUCT_HAS_ORDERS",
        },
        {
          status: 409,
        },
      );
    }

    if (
      product._count.digitalKeys >
      0
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "PRODUCT_HAS_DIGITAL_KEYS",
        },
        {
          status: 409,
        },
      );
    }

    await db.$transaction(
      async (transaction) => {
        await transaction.gameProduct.delete(
          {
            where: {
              id: productId,
            },
          },
        );

        await transaction.auditLog.create(
          {
            data: {
              actorUserId:
                owner.id,

              action:
                "STORE_PRODUCT_DELETED",

              entityType:
                "GameProduct",

              entityId:
                productId,

              metadata: {
                sku:
                  product.sku,

                title:
                  product.title,
              },
            },
          },
        );
      },
    );

    return NextResponse.json({
      success: true,
      deleted: true,
    });
  } catch (error) {
    if (
      error instanceof
      z.ZodError
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "INVALID_PRODUCT_ID",
        },
        {
          status: 400,
        },
      );
    }

    console.error(
      "DELETE /api/admin/products/[id] error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "PRODUCT_DELETE_FAILED",
      },
      {
        status: 400,
      },
    );
  }
}
