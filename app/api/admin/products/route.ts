import { NextRequest, NextResponse } from "next/server";
import {
  DeliveryType,
  ProductKind,
} from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";

export const dynamic = "force-dynamic";

const productSchema = z.object({
  gameId: z.string().cuid(),
  sku: z.string().trim().min(2).max(120),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5000).nullable().optional(),

  priceCents: z.number().int().min(0).max(100000000),
  rewardPoints: z.number().int().min(0).max(100000000).nullable().optional(),
  currency: z
    .string()
    .trim()
    .min(3)
    .max(10)
    .transform((value) => value.toUpperCase()),

  kind: z.nativeEnum(ProductKind),
  deliveryType: z.nativeEnum(DeliveryType),

  inventory: z
    .number()
    .int()
    .min(0)
    .nullable()
    .optional(),

  region: z.string().trim().max(100).nullable().optional(),
  country: z.string().trim().max(100).nullable().optional(),
  provider: z.string().trim().max(200).nullable().optional(),

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
});

function nullableString(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function GET(request: NextRequest) {
  const blocked = await guardRead(
    request,
    "admin:products",
    60,
  );

  if (blocked) return blocked;

  try {
    await requireOwner();

    const products = await db.gameProduct.findMany({
      orderBy: {
        updatedAt: "desc",
      },
      take: 200,
      include: {
        game: {
          select: {
            id: true,
            slug: true,
            titleAr: true,
            titleEn: true,
            coverUrl: true,
            published: true,
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
      },
    });

    return NextResponse.json({
      success: true,
      data: products,
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: "FORBIDDEN",
      },
      { status: 403 },
    );
  }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(
    request,
    "admin:products:create",
    20,
  );

  if (blocked) return blocked;

  try {
    const owner = await requireOwner();

    const body = productSchema.parse(
      await request.json(),
    );

    const game = await db.game.findUnique({
      where: {
        id: body.gameId,
      },
      select: {
        id: true,
        published: true,
      },
    });

    if (!game) {
      return NextResponse.json(
        {
          success: false,
          error: "GAME_NOT_FOUND",
        },
        { status: 404 },
      );
    }

    const existingSku = await db.gameProduct.findUnique({
      where: {
        sku: body.sku,
      },
      select: {
        id: true,
      },
    });

    if (existingSku) {
      return NextResponse.json(
        {
          success: false,
          error: "SKU_ALREADY_EXISTS",
        },
        { status: 409 },
      );
    }

    const product = await db.$transaction(
      async (transaction) => {
        const created =
          await transaction.gameProduct.create({
            data: {
              gameId: body.gameId,
              sku: body.sku,
              title: body.title,
              description: nullableString(
                body.description,
              ),

              priceCents: body.priceCents,
              rewardPoints: body.rewardPoints ?? null,
              currency: body.currency,

              kind: body.kind,
              deliveryType: body.deliveryType,

              inventory:
                body.inventory === undefined
                  ? 0
                  : body.inventory,

              region: nullableString(body.region),
              country: nullableString(body.country),
              provider: nullableString(body.provider),

              sourceUrl: nullableString(
                body.sourceUrl,
              ),

              redemptionInstructions:
                nullableString(
                  body.redemptionInstructions,
                ),

              /*
               * المنتجات الجديدة لا تدخل المتجر العام
               * تلقائيًا.
               *
               * يجب أولًا توثيق المورد ثم تفعيل المنتج
               * من نظام الإدارة.
               */
              active: false,
              supplierVerified: false,
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
                },
              },
            },
          });

        await transaction.auditLog.create({
          data: {
            actorUserId: owner.id,
            action: "STORE_PRODUCT_CREATED",
            entityType: "GameProduct",
            entityId: created.id,
            metadata: {
              sku: created.sku,
              title: created.title,
              kind: created.kind,
              deliveryType: created.deliveryType,
              gameId: created.gameId,
              priceCents: created.priceCents,
              currency: created.currency,
            },
          },
        });

        return created;
      },
    );

    return NextResponse.json(
      {
        success: true,
        data: product,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: "INVALID_PRODUCT",
          details: error.flatten(),
        },
        { status: 400 },
      );
    }

    console.error(
      "POST /api/admin/products error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error: "PRODUCT_CREATE_FAILED",
      },
      { status: 400 },
    );
  }
}
