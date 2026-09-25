import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { guardRead } from "@/lib/api";
import { db } from "@/lib/prisma";
import {
  getVideoStatus,
  MiniMaxProviderError,
} from "@/lib/ai/providers/minimax";
import { releaseAiCredits } from "@/lib/vip-credits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type VideoJobStatus =
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED";

function providerErrorResponse(error: unknown) {
  if (!(error instanceof MiniMaxProviderError)) {
    return NextResponse.json(
      {
        error: "AI_VIDEO_STATUS_FAILED",
        message: "تعذر الحصول على حالة الفيديو حاليًا.",
      },
      { status: 502 },
    );
  }

  switch (error.message) {
    case "MINIMAX_NOT_CONFIGURED":
      return NextResponse.json(
        {
          error: "MINIMAX_NOT_CONFIGURED",
          message: "خدمة الفيديو غير مهيأة حاليًا.",
        },
        { status: 503 },
      );

    case "MINIMAX_RATE_LIMITED":
      return NextResponse.json(
        {
          error: "MINIMAX_RATE_LIMITED",
          message: "تم تجاوز الحد المؤقت لخدمة الفيديو. حاول مرة أخرى لاحقًا.",
        },
        { status: 429 },
      );

    case "MINIMAX_TIMEOUT":
      return NextResponse.json(
        {
          error: "MINIMAX_TIMEOUT",
          message: "انتهت مهلة الاتصال بخدمة الفيديو.",
        },
        { status: 504 },
      );

    case "MINIMAX_UNAUTHORIZED":
      return NextResponse.json(
        {
          error: "MINIMAX_UNAUTHORIZED",
          message: "تعذر المصادقة مع خدمة الفيديو.",
        },
        { status: 502 },
      );

    case "MINIMAX_BAD_REQUEST":
      return NextResponse.json(
        {
          error: "MINIMAX_BAD_REQUEST",
          message: "طلب الفيديو غير صالح لدى مزود الخدمة.",
        },
        { status: 400 },
      );

    case "MINIMAX_SERVER_ERROR":
      return NextResponse.json(
        {
          error: "MINIMAX_SERVER_ERROR",
          message: "خدمة الفيديو تواجه مشكلة مؤقتة.",
        },
        { status: 502 },
      );

    default:
      return NextResponse.json(
        {
          error: error.message || "AI_VIDEO_STATUS_FAILED",
          message: "تعذر الحصول على حالة الفيديو حاليًا.",
        },
        { status: 502 },
      );
  }
}

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "ai:video:status", 60);
  if (blocked) return blocked;

  const user = await requireUser();

  const jobId = request.nextUrl.searchParams.get("jobId");

  if (!jobId || jobId.length > 100) {
    return NextResponse.json(
      {
        error: "INVALID_REQUEST",
        message: "معرف مهمة الفيديو غير صالح.",
      },
      { status: 400 },
    );
  }

  const job = await db.aiMediaJob.findFirst({
    where: {
      id: jobId,
      userId: user.id,
    },
  });

  if (!job) {
    return NextResponse.json(
      {
        error: "NOT_FOUND",
        message: "مهمة الفيديو غير موجودة.",
      },
      { status: 404 },
    );
  }

  /*
   * إذا كانت المهمة انتهت بالفعل، لا نستدعي MiniMax مرة أخرى.
   *
   * هذا يمنع polling غير الضروري بعد اكتمال المهمة أو فشلها.
   */
  if (job.status === "COMPLETED" || job.status === "FAILED") {
    return NextResponse.json({
      ok: true,
      job,
    });
  }

  /*
   * لا يمكن متابعة المهمة مع MiniMax بدون providerTaskId.
   */
  if (job.provider !== "MINIMAX" || !job.providerTaskId) {
    return NextResponse.json({
      ok: true,
      job,
    });
  }

  try {
    const result = await getVideoStatus(job.providerTaskId);

    let status: VideoJobStatus = job.status;
    let resultUrl = job.resultUrl ?? null;
    let providerFileId = job.providerFileId ?? null;

    switch (result.status) {
      case "Success":
        status = "COMPLETED";
        resultUrl = result.url ?? null;
        providerFileId = result.fileId ?? null;
        break;

      case "Failed":
      case "Fail":
        status = "FAILED";
        break;

      case "Processing":
      case "Preparing":
        status = "PROCESSING";
        break;

      default:
        /*
         * إذا أرسل MiniMax حالة غير معروفة، لا نعتبر الفيديو
         * فاشلًا تلقائيًا ولا نرجع الرصيد.
         */
        status = job.status;
        break;
    }

    const updated = await db.aiMediaJob.update({
      where: {
        id: job.id,
      },
      data: {
        status,
        resultUrl,
        providerFileId,
      },
    });

    /*
     * في هذه النقطة، إذا أصبحت الحالة FAILED فهذا يعني أن
     * MiniMax أعلن فشل المهمة في هذا الطلب.
     *
     * releaseAiCredits() يتعامل مع idempotency داخليًا،
     * لذلك لا نحتاج مقارنة الحالة القديمة هنا.
     */
    if (status === "FAILED") {
      try {
        await releaseAiCredits(job.idempotencyKey);
      } catch (refundError) {
        /*
         * لا نغير حالة مهمة الفيديو بسبب مشكلة في عملية
         * الاسترداد. نسجل الخطأ فقط.
         */
        console.error(
          "AI video credit release failed:",
          refundError,
          {
            jobId: job.id,
            userId: user.id,
            idempotencyKey: job.idempotencyKey,
          },
        );
      }
    }

    return NextResponse.json({
      ok: true,
      job: updated,
    });
  } catch (error) {
    return providerErrorResponse(error);
  }
}
