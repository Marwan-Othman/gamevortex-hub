import { randomUUID } from "node:crypto";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

import {
  consumeVideoCredits,
  releaseAiCredits,
} from "@/lib/vip-credits";

import { db } from "@/lib/prisma";

import {
  createVideo,
  MiniMaxProviderError,
} from "@/lib/ai/providers/minimax";

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

  imageUrl: z
    .string()
    .url()
    .max(4000)
    .optional(),

  duration: z
    .number()
    .int()
    .min(1)
    .max(15)
    .optional(),

  resolution: z
    .enum([
      "720P",
      "768P",
      "1080P",
      "2K",
    ])
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
    error instanceof
    MiniMaxProviderError
  ) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "AI_VIDEO_FAILED";
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

    case "MINIMAX_NOT_CONFIGURED":
      return 503;

    case "MINIMAX_RATE_LIMITED":
      return 429;

    case "MINIMAX_TIMEOUT":
      return 504;

    case "MINIMAX_UNAUTHORIZED":
      return 502;

    case "MINIMAX_BAD_REQUEST":
      return 400;

    case "MINIMAX_SERVER_ERROR":
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

    case "MINIMAX_NOT_CONFIGURED":
      return "AI_PROVIDER_NOT_CONFIGURED";

    case "MINIMAX_RATE_LIMITED":
      return "AI_PROVIDER_RATE_LIMITED";

    case "MINIMAX_TIMEOUT":
      return "AI_TIMEOUT";

    case "MINIMAX_UNAUTHORIZED":
      return "AI_PROVIDER_UNAUTHORIZED";

    case "MINIMAX_BAD_REQUEST":
      return "AI_PROVIDER_BAD_REQUEST";

    case "MINIMAX_SERVER_ERROR":
      return "AI_PROVIDER_ERROR";

    default:
      return "AI_VIDEO_FAILED";
  }
}

function getUserFacingMessage(
  errorCode: string,
): string | null {
  switch (errorCode) {
    case "AI_CREDITS_EXHAUSTED":
      return "انتهت أرصدة الفيديو الخاصة بك في GameVortex AI.";

    case "AI_WALLET_BALANCE_EXHAUSTED":
      return "رصيد محفظتك غير كافٍ لإنشاء الفيديو باستخدام GameVortex AI.";

    case "AI_WALLET_NOT_FOUND":
      return "لم يتم العثور على محفظة GameVortex الخاصة بحسابك.";

    case "AI_BILLING_NOT_CONFIGURED":
      return "الاستخدام المدفوع للفيديو في GameVortex AI غير متاح حاليًا.";

    case "AI_REFUND_WALLET_NOT_FOUND":
      return "تعذر معالجة محفظة GameVortex بعد فشل إنشاء الفيديو.";

    case "MINIMAX_NOT_CONFIGURED":
      return "مزود الفيديو AI غير مُعد حاليًا.";

    case "MINIMAX_RATE_LIMITED":
      return "تم الوصول إلى حد استخدام مزود الفيديو مؤقتًا. حاول لاحقًا.";

    case "MINIMAX_TIMEOUT":
      return "انتهت مهلة إرسال مهمة الفيديو. لم يتم احتساب الاستخدام.";

    case "MINIMAX_UNAUTHORIZED":
      return "تعذر التحقق من صلاحية مزود الفيديو.";

    case "MINIMAX_BAD_REQUEST":
      return "تعذر إرسال طلب إنشاء الفيديو بسبب بيانات الطلب.";

    case "MINIMAX_SERVER_ERROR":
      return "حدث خطأ لدى مزود الفيديو. لم يتم احتساب الاستخدام.";

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
 * POST /api/ai/video
 * ======================================================= */

export async function POST(
  request: NextRequest,
) {
  const blocked =
    await guardMutation(
      request,
      "ai:video",
      5,
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

      return NextResponse.json(
        {
          ok: true,

          job:
            existing,

          idempotencyKey,
        },
        {
          status:
            existing.status ===
            "COMPLETED"
              ? 200
              : 202,
        },
      );
    }

    /* -----------------------------------------------------
     * AI CREDIT / BILLING
     * --------------------------------------------------- */

    /*
     * consumeVideoCredits() is the server-side authority.
     *
     * It handles:
     *
     * - SUPER_ADMIN unlimited access
     * - FREE video credits
     * - VIP video credits
     * - User wallet billing
     * - Idempotency
     *
     * No client-supplied credit balance is trusted.
     *
     * If the user has no available credit and no sufficient
     * wallet balance, MiniMax is NEVER called.
     */
    let credit;

    try {
      credit =
        await consumeVideoCredits({
          userId:
            user.id,

          amount:
            1,

          idempotencyKey,

          metadata: {
            provider:
              "minimax",

            operation:
              "video_generation",

            duration:
              parsed.data
                .duration ??
              null,

            resolution:
              parsed.data
                .resolution ??
              null,

            hasImage:
              Boolean(
                parsed.data
                  .imageUrl,
              ),
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
     * MINIMAX VIDEO GENERATION
     * --------------------------------------------------- */

    let provider;

    try {
      provider =
        await createVideo(
          parsed.data,
        );
    } catch (error) {
      /*
       * MiniMax failed before a usable video task was
       * created.
       *
       * Return the reserved:
       *
       * - VIP credit, OR
       * - user wallet charge.
       *
       * SUPER_ADMIN has no wallet charge.
       */
      if (!credit.reused) {
        try {
          await releaseAiCredits(
            idempotencyKey,
          );
        } catch {
          /*
           * Preserve the original MiniMax error.
           */
        }
      }

      throw error;
    }

    /* -----------------------------------------------------
     * SAVE VIDEO JOB
     * --------------------------------------------------- */

    let job;

    try {
      job =
        await db.aiMediaJob.create({
          data: {
            userId:
              user.id,

            kind:
              "VIDEO",

            provider:
              "MINIMAX",

            providerTaskId:
              provider.taskId,

            model:
              provider.model,

            prompt:
              parsed.data.prompt,

            status:
              "QUEUED",

            idempotencyKey,
          },
        });
    } catch (error) {
      /*
       * MiniMax accepted the request, but GameVortex could
       * not persist the task.
       *
       * Return the reserved GameVortex credit / wallet
       * charge rather than silently charging the user.
       *
       * NOTE:
       *
       * MiniMax may already have received the task.
       * The provider task itself is not cancelled here.
       * This is why the status endpoint and persistent job
       * tracking remain important.
       */
      if (!credit.reused) {
        try {
          await releaseAiCredits(
            idempotencyKey,
          );
        } catch {
          /*
           * Preserve the original database error.
           */
        }
      }

      throw error;
    }

    /* -----------------------------------------------------
     * SUCCESS
     * --------------------------------------------------- */

    return NextResponse.json(
      {
        ok: true,

        provider:
          "MiniMax",

        model:
          provider.model,

        taskId:
          provider.taskId,

        job,

        idempotencyKey,
      },
      {
        status: 202,
      },
    );
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
