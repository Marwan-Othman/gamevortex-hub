import { NextRequest, NextResponse } from "next/server";
import {
  handleUpload,
  type HandleUploadBody,
} from "@vercel/blob/client";
import { getOptionalUser } from "@/lib/auth";
import {
  WALLPAPER_IMAGE_MIME_TYPES,
  WALLPAPER_MAX_FILE_SIZE,
} from "@/lib/wallpaper-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GameVortex Wallpaper Blob Client Upload
 *
 * يدعم طريقتين للمصادقة مع Vercel Blob:
 *
 * 1. BLOB_READ_WRITE_TOKEN
 *    للتخزين التقليدي باستخدام Read/Write Token.
 *
 * 2. Vercel OIDC
 *    عند ربط Blob بالمشروع واستخدام OIDC في Vercel،
 *    يمكن لـ Vercel Function المصادقة تلقائيًا بدون
 *    الحاجة إلى BLOB_READ_WRITE_TOKEN.
 *
 * مهم:
 * BLOB_READ_WRITE_TOKEN لا يتم إرساله إلى المتصفح أبدًا.
 */

function getBlobToken() {
  const value =
    process.env.BLOB_READ_WRITE_TOKEN?.trim();

  return value || undefined;
}

function isValidWallpaperPath(
  pathname: unknown,
): pathname is string {
  if (typeof pathname !== "string") {
    return false;
  }

  const value = pathname.trim();

  if (!value) {
    return false;
  }

  if (!value.startsWith("wallpapers/")) {
    return false;
  }

  /*
   * منع path traversal.
   */
  if (
    value.includes("..") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    return false;
  }

  return true;
}

function isAllowedWallpaperMimeType(
  value: unknown,
): boolean {
  if (typeof value !== "string") {
    return false;
  }

  return (
    WALLPAPER_IMAGE_MIME_TYPES as readonly string[]
  ).includes(value.toLowerCase());
}

export async function POST(
  request: NextRequest,
) {
  try {
    /*
     * ------------------------------------------------------------
     * 1. قراءة body القادم من @vercel/blob/client
     * ------------------------------------------------------------
     *
     * upload() في المتصفح يرسل JSON إلى هذا endpoint
     * حتى يحصل على clientToken.
     */
    let body: HandleUploadBody;

    try {
      body =
        (await request.json()) as HandleUploadBody;
    } catch (error) {
      console.error(
        "GameVortex Blob upload body parsing failed:",
        error,
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "بيانات طلب رفع الخلفية غير صالحة.",
        },
        {
          status: 400,
        },
      );
    }

    /*
     * ------------------------------------------------------------
     * 2. تجهيز Blob authentication
     * ------------------------------------------------------------
     *
     * لا نفرض وجود BLOB_READ_WRITE_TOKEN هنا.
     *
     * إذا كان موجودًا سيتم تمريره إلى handleUpload.
     *
     * وإذا لم يكن موجودًا، يستطيع Vercel استخدام OIDC
     * عند تفعيل OIDC على Blob Store المرتبط بالمشروع.
     */
    const blobToken = getBlobToken();

    /*
     * ------------------------------------------------------------
     * 3. إنشاء client token
     * ------------------------------------------------------------
     *
     * handleUpload مسؤول عن إنشاء token قصير العمر
     * خاص بالمتصفح.
     *
     * لا نرسل BLOB_READ_WRITE_TOKEN للعميل.
     */
    const response = await handleUpload({
      ...(blobToken
        ? {
            token: blobToken,
          }
        : {}),

      request,

      body,

      /*
       * ----------------------------------------------------------
       * يتم استدعاء هذا الجزء عند طلب المتصفح إنشاء
       * client upload token.
       * ----------------------------------------------------------
       */
      onBeforeGenerateToken:
        async (pathname) => {
          /*
           * ------------------------------------------------------
           * Authentication
           * ------------------------------------------------------
           *
           * المستخدم يجب أن يكون SUPER_ADMIN.
           *
           * هذا التحقق يتم هنا وليس قبل handleUpload،
           * لأن Vercel Blob قد يرسل callback منفصلًا
           * بعد اكتمال الرفع ولا يحمل session cookie.
           */
          const user =
            await getOptionalUser();

          if (
            !user ||
            user.role !== "SUPER_ADMIN"
          ) {
            console.warn(
              "GameVortex wallpaper upload rejected: unauthorized user.",
            );

            throw new Error(
              "UNAUTHORIZED",
            );
          }

          /*
           * ------------------------------------------------------
           * Validate pathname
           * ------------------------------------------------------
           */
          if (
            !isValidWallpaperPath(
              pathname,
            )
          ) {
            console.warn(
              "GameVortex wallpaper upload rejected: invalid pathname.",
              pathname,
            );

            throw new Error(
              "INVALID_WALLPAPER_UPLOAD_PATH",
            );
          }

          /*
           * ------------------------------------------------------
           * Upload restrictions
           * ------------------------------------------------------
           *
           * نسمح فقط بصيغ الصور التي يدعمها
           * نظام GameVortex Wallpaper.
           */
          return {
            allowedContentTypes: [
              ...WALLPAPER_IMAGE_MIME_TYPES,
            ],

            maximumSizeInBytes:
              WALLPAPER_MAX_FILE_SIZE,

            addRandomSuffix: true,
          };
        },

      /*
       * ----------------------------------------------------------
       * Upload completed
       * ----------------------------------------------------------
       *
       * لا نقوم بإنشاء سجل Prisma هنا.
       *
       * بعد أن يحصل المتصفح على blob.url،
       * يقوم WallpaperAdminClient بإرسال بيانات
       * الخلفية إلى:
       *
       * /api/admin/wallpapers
       *
       * وهذا endpoint يقوم بإنشاء سجل قاعدة البيانات.
       *
       * وجود callback هنا اختياري، لذلك نحتفظ به
       * فقط للتسجيل في سجلات Vercel.
       */
      onUploadCompleted:
        async ({ blob }) => {
          console.log(
            "GameVortex wallpaper Blob upload completed:",
            {
              url: blob.url,
              pathname: blob.pathname,
            },
          );
        },
    });

    /*
     * ------------------------------------------------------------
     * 4. إرجاع client token للمتصفح
     * ------------------------------------------------------------
     *
     * handleUpload يعيد الاستجابة التي يحتاجها
     * @vercel/blob/client.
     */
    return NextResponse.json(
      response,
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error(
      "GameVortex wallpaper Blob upload handshake failed:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "UNKNOWN_BLOB_UPLOAD_ERROR";

    /*
     * ------------------------------------------------------------
     * Authentication error
     * ------------------------------------------------------------
     */
    if (
      message ===
      "UNAUTHORIZED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "غير مصرح لك برفع الخلفيات. يجب أن تكون SUPER_ADMIN.",
        },
        {
          status: 401,
        },
      );
    }

    /*
     * ------------------------------------------------------------
     * Invalid path
     * ------------------------------------------------------------
     */
    if (
      message ===
      "INVALID_WALLPAPER_UPLOAD_PATH"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "مسار رفع الخلفية غير صالح.",
        },
        {
          status: 400,
        },
      );
    }

    /*
     * ------------------------------------------------------------
     * Blob configuration/authentication errors
     * ------------------------------------------------------------
     *
     * لا نعرض أي secret أو token للمستخدم.
     */
    const safeMessage =
      message.toLowerCase();

    if (
      safeMessage.includes(
        "token",
      ) ||
      safeMessage.includes(
        "authentication",
      ) ||
      safeMessage.includes(
        "unauthorized",
      ) ||
      safeMessage.includes(
        "access denied",
      )
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "تعذر المصادقة مع Vercel Blob. تأكد من ربط Blob بالمشروع وتفعيل OIDC أو إضافة BLOB_READ_WRITE_TOKEN في Production.",
        },
        {
          status: 500,
        },
      );
    }

    /*
     * ------------------------------------------------------------
     * Generic error
     * ------------------------------------------------------------
     */
    return NextResponse.json(
      {
        success: false,
        error:
          "فشل إنشاء تصريح رفع الخلفية إلى Vercel Blob.",
      },
      {
        status: 500,
      },
    );
  }
}
