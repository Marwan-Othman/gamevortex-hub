import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

import {
  consumeImageCredits,
  releaseAiCredits,
} from "@/lib/vip-credits";

import { db } from "@/lib/prisma";

import {
  generateImage,
  FalProviderError,
} from "@/lib/ai/providers/fal";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

/* =========================================================
 * REQUEST VALIDATION
 * ======================================================= */

const schema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(4000),

  imageSize: z
    .enum([
      "square_hd",
      "square",
      "portrait_4_3",
      "portrait_16_9",
      "landscape_4_3",
      "landscape_16_9",
    ])
    .optional(),

  numImages: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional(),

  idempotencyKey: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .optional(),
});

/* =========================================================
 * ERROR HELPERS
 * ======================================================= */

function getErrorCode(
  error: unknown,
): string {
  if (
    error instanceof FalProviderError
  ) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "AI_IMAGE_FAILED";
}

function getErrorStatus(
  errorCode: string,
): number {
  switch (errorCode) {
    case "AI_CREDITS_EXHAUSTED":
      return 402;

    case "AI_WALLET_BALANCE_EXHAUSTED":
      return 402;

    case "AI_WALLET_NOT_FOUND":
      return 503;

    case "AI_BILLING_NOT_CONFIGURED":
      return 503;

    case "AI_REFUND_WALLET_NOT_FOUND":
      return 503;

    case "FAL_NOT_CONFIGURED":
      return 503;

    case "FAL_RATE_LIMITED":
      return 429;

    case "FAL_TIMEOUT":
      return 504;

    case "FAL_UNAUTHORIZED":
      return 502;

    case "FAL_BAD_REQUEST":
      return 400;

    case "FAL_SERVER_ERROR":
      return 502;

    default:
      return 502;
  }
}

function getPublicError(
  errorCode: string,
): string {
  switch (errorCode) {
    case "AI_CREDITS_EXHAUSTED":
      return "AI_CREDITS_EXHAUSTED";

    case "AI_WALLET_BALANCE_EXHAUSTED":
      return "AI_WALLET_BALANCE_EXHAUSTED";

    case "AI_WALLET_NOT_FOUND":
      return "AI_WALLET_NOT_FOUND";

    case "AI_BILLING_NOT_CONFIGURED":
      return "AI_BILLING_NOT_CONFIGURED";

    case "AI_REFUND_WALLET_NOT_FOUND":
      return "AI_REFUND_WALLET_NOT_FOUND";

    case "FAL_NOT_CONFIGURED":
      return "AI_PROVIDER_NOT_CONFIGURED";

    case "FAL_RATE_LIMITED":
      return "AI_PROVIDER_RATE_LIMITED";

    case "FAL_TIMEOUT":
      return "AI_TIMEOUT";

    case "FAL_UNAUTHORIZED":
      return "AI_PROVIDER_UNAUTHORIZED";

    case "FAL_BAD_REQUEST":
      return "AI_PROVIDER_BAD_REQUEST";

    case "FAL_SERVER_ERROR":
      return "AI_PROVIDER_ERROR";

    default:
      return "AI_IMAGE_FAILED";
  }
}

function getUserFacingMessage(
  errorCode: string,
): string | null {
  switch (errorCode) {
    case "AI_CREDITS_EXHAUSTED":
      return "انتهت أرصدة الصور الخاصة بك في GameVortex AI.";

    case "AI_WALLET_BALANCE_EXHAUSTED":
      return "رصيد محفظتك غير كافٍ لإنشاء الصور باستخدام GameVortex AI.";

    case "AI_WALLET_NOT_FOUND":
      return "لم يتم العثور على محفظة GameVortex الخاصة بحسابك.";

    case "AI_BILLING_NOT_CONFIGURED":
      return "الاستخدام المدفوع للصور في GameVortex AI غير متاح حاليًا.";

    case "AI_REFUND_WALLET_NOT_FOUND":
      return "تعذر معالجة محفظة GameVortex بعد فشل إنشاء الصورة.";

    case "FAL_NOT_CONFIGURED":
      return "مزود الصور AI غير مُعد حاليًا.";

    case "FAL_RATE_LIMITED":
      return "تم الوصول إلى حد استخدام مزود الصور مؤقتًا. حاول لاحقًا.";

    case "FAL_TIMEOUT":
      return "انتهت مهلة إنشاء الصورة. لم يتم احتساب الاستخدام.";

    case "FAL_UNAUTHORIZED":
      return "تعذر التحقق من صلاحية مزود الصور.";

    case "FAL_BAD_REQUEST":
      return "تعذر إرسال طلب إنشاء الصورة بسبب بيانات الطلب.";

    case "FAL_SERVER_ERROR":
      return "حدث خطأ لدى مزود الصور. لم يتم احتساب الاستخدام.";

    default:
      return null;
  }
}

function buildErrorResponse(
  error: unknown,
) {
  const errorCode =
    getErrorCode(error);

  const status =
    getErrorStatus(
      errorCode,
    );

  const publicError =
    getPublicError(
      errorCode,
    );

  const message =
    getUserFacingMessage(
      errorCode,
    );

  return {
    error:
      message ??
      publicError,

    publicError,

    providerCode:
      errorCode,

    status,
  };
}

/* =========================================================
 * POST /api/ai/image
 * ======================================================= */

export async function POST(
  request: NextRequest,
) {
  const blocked =
    await guardMutation(
      request,
      "ai:image",
      10,
    );

  if (blocked) {
    return blocked;
  }

  /* -------------------------------------------------------
   * AUTH
   * ----------------------------------------------------- */

  const user =
    await requireUser();

  /* -------------------------------------------------------
   * REQUEST VALIDATION
   * ----------------------------------------------------- */

  const parsed =
    schema.safeParse(
      await request
        .json()
        .catch(
          () => null,
        ),
    );

  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "INVALID_REQUEST",
      },
      {
        status: 400,
      },
    );
  }

  const idempotencyKey =
    parsed.data.idempotencyKey ??
    randomUUID();

  const amount =
    parsed.data.numImages ??
    1;

  /* =======================================================
   * PROCESS
   * ===================================================== */

  try {
    /* -----------------------------------------------------
     * IDEMPOTENCY
     * --------------------------------------------------- */

    const existing =
      await db.aiMediaJob.findUnique({
        where: {
          idempotencyKey,
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

      return NextResponse.json({
        ok: true,

        job:
          existing,

        images:
          existing.resultUrl
            ? [
                existing.resultUrl,
              ]
            : [],

        idempotencyKey,
      });
    }

    /* -----------------------------------------------------
     * AI CREDIT / BILLING
     * --------------------------------------------------- */

    /*
     * This is the server-side authority.
     *
     * consumeImageCredits() handles:
     *
     * - SUPER_ADMIN unlimited access
     * - FREE image credits
     * - VIP image credits
     * - User wallet billing
     * - Idempotency
     *
     * No client-supplied credit balance is trusted.
     *
     * Most importantly:
     *
     * If the user's credits and wallet are exhausted,
     * this throws BEFORE generateImage() is called.
     */
    let credit;

    try {
      credit =
        await consumeImageCredits({
          userId:
            user.id,

          amount,

          idempotencyKey,

          metadata: {
            provider:
              "fal.ai",

            operation:
              "image_generation",

            numImages:
              amount,
          },
        });
    } catch (creditError) {
      const response =
        buildErrorResponse(
          creditError,
        );

      return NextResponse.json(
        {
          error:
            response.error,

          publicError:
            response.publicError,

          providerCode:
            response.providerCode,

          idempotencyKey,
        },
        {
          status:
            response.status,
        },
      );
    }

    /* -----------------------------------------------------
     * FAL.AI IMAGE GENERATION
     * --------------------------------------------------- */

    let result;

    try {
      result =
        await generateImage(
          parsed.data,
        );
    } catch (error) {
      /*
       * fal.ai failed after the AI credit reservation.
       *
       * Return:
       *
       * - VIP credits, OR
       * - user's wallet payment.
       *
       * SUPER_ADMIN does not have a wallet charge,
       * so releaseAiCredits() has nothing to refund.
       */
      if (!credit.reused) {
        try {
          await releaseAiCredits(
            idempotencyKey,
          );
        } catch {
          /*
           * Do not replace the original provider error
           * with a refund error.
           *
           * The original error is returned below.
           */
        }
      }

      throw error;
    }

    /* -----------------------------------------------------
     * SAVE AI MEDIA JOB
     * --------------------------------------------------- */

    let job;

    try {
      job =
        await db.aiMediaJob.create({
          data: {
            userId:
              user.id,

            kind:
              "IMAGE",

            provider:
              "FAL",

            model:
              result.model,

            prompt:
              parsed.data.prompt,

            status:
              "COMPLETED",

            resultUrl:
              result.urls[0] ??
              null,

            idempotencyKey,
          },
        });
    } catch (error) {
      /*
       * fal.ai successfully generated the image,
       * but GameVortex failed to persist the job.
       *
       * Return the reserved AI credit / wallet charge.
       */
      if (!credit.reused) {
        try {
          await releaseAiCredits(
            idempotencyKey,
          );
        } catch {
          /*
           * Keep the original database error.
           */
        }
      }

      throw error;
    }

    /* -----------------------------------------------------
     * SUCCESS
     * --------------------------------------------------- */

    return NextResponse.json({
      ok: true,

      provider:
        "fal.ai",

      model:
        result.model,

      images:
        result.urls,

      job,

      idempotencyKey,
    });
  } catch (error) {
    const response =
      buildErrorResponse(
        error,
      );

    return NextResponse.json(
      {
        error:
          response.error,

        publicError:
          response.publicError,

        providerCode:
          response.providerCode,

        idempotencyKey,
      },
      {
        status:
          response.status,
      },
    );
  }
}
