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

const MAX_PATHNAME_LENGTH = 500;

function cleanPathname(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .slice(0, MAX_PATHNAME_LENGTH);
}

function isSafeWallpaperPathname(
  pathname: string,
): boolean {
  if (!pathname) {
    return false;
  }

  if (pathname.includes("..")) {
    return false;
  }

  if (pathname.includes("\0")) {
    return false;
  }

  if (pathname.startsWith("/")) {
    return false;
  }

  return true;
}

function normalizeWallpaperPathname(
  pathname: string,
): string {
  const cleaned = cleanPathname(pathname);

  if (!cleaned) {
    throw new Error(
      "INVALID_WALLPAPER_UPLOAD_PATH",
    );
  }

  if (!isSafeWallpaperPathname(cleaned)) {
    throw new Error(
      "INVALID_WALLPAPER_UPLOAD_PATH",
    );
  }

  /*
   * الواجهة قد ترسل:
   *
   * image.jpg
   *
   * بدل:
   *
   * wallpapers/image.jpg
   *
   * لذلك نضيف مجلد wallpapers تلقائيًا.
   */
  if (!cleaned.startsWith("wallpapers/")) {
    return `wallpapers/${cleaned}`;
  }

  return cleaned;
}

function isAuthorizedUploadPath(
  pathname: string,
): boolean {
  const normalized =
    normalizeWallpaperPathname(pathname);

  return (
    normalized.startsWith(
      "wallpapers/",
    ) &&
    !normalized.includes("..")
  );
}

function getErrorMessage(
  error: unknown,
): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Upload authorization failed";
}

export async function POST(
  request: NextRequest,
) {
  try {
    /*
     * مهم:
     *
     * هذا endpoint يستقبل طلبين مختلفين:
     *
     * 1. طلب المتصفح للحصول على client token.
     * 2. callback من Vercel Blob بعد اكتمال الرفع.
     *
     * لذلك لا نضع فحص المستخدم خارج
     * onBeforeGenerateToken().
     */

    const body =
      (await request.json()) as HandleUploadBody;

    /*
     * نتأكد أن جسم الطلب صالح قبل تمريره
     * إلى Vercel Blob.
     */
    if (
      !body ||
      typeof body !== "object"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid upload request.",
        },
        { status: 400 },
      );
    }

    /*
     * نستخدم token الموجود في البيئة إذا كان
     * متوفرًا.
     *
     * وإذا كان المشروع يستخدم OIDC في Vercel،
     * فلا نجبر SDK على token ثابت.
     *
     * هذا يجعل الكود يعمل مع:
     *
     * - BLOB_READ_WRITE_TOKEN
     * - Vercel Blob OIDC
     */
    const blobToken =
      process.env.BLOB_READ_WRITE_TOKEN?.trim();

    const response =
      await handleUpload({
        request,
        body,

        ...(blobToken
          ? {
              token: blobToken,
            }
          : {}),

        onBeforeGenerateToken:
          async (
            pathname,
            clientPayload,
            multipart,
          ) => {
            /*
             * التحقق من المستخدم يتم هنا فقط
             * عندما يطلب المتصفح client token.
             */
            const user =
              await getOptionalUser();

            if (
              user?.role !==
              "SUPER_ADMIN"
            ) {
              throw new Error(
                "UNAUTHORIZED",
              );
            }

            /*
             * تنظيف المسار.
             */
            const normalizedPathname =
              normalizeWallpaperPathname(
                pathname,
              );

            /*
             * حماية إضافية.
             */
            if (
              !isAuthorizedUploadPath(
                normalizedPathname,
              )
            ) {
              throw new Error(
                "INVALID_WALLPAPER_UPLOAD_PATH",
              );
            }

            /*
             * لا نسمح برفع ملفات ضخمة.
             */
            if (
              WALLPAPER_MAX_FILE_SIZE <=
              0
            ) {
              throw new Error(
                "WALLPAPER_UPLOAD_LIMIT_NOT_CONFIGURED",
              );
            }

            /*
             * clientPayload اختياري.
             *
             * لا نثق به ولا نستخدمه لتحديد
             * صلاحيات المستخدم.
             */
            let safeClientPayload:
              string | null = null;

            if (
              typeof clientPayload ===
                "string" &&
              clientPayload.length > 0
            ) {
              safeClientPayload =
                clientPayload.slice(
                  0,
                  2000,
                );
            }

            /*
             * Vercel Blob يحتاج فقط إلى
             * إعدادات السماح بالرفع.
             */
            return {
              allowedContentTypes: [
                ...WALLPAPER_IMAGE_MIME_TYPES,
              ],

              maximumSizeInBytes:
                WALLPAPER_MAX_FILE_SIZE,

              addRandomSuffix: true,

              /*
               * نرسل معلومات بسيطة مع token.
               *
               * لا نضع بيانات حساسة هنا.
               */
              tokenPayload:
                JSON.stringify({
                  userId: user.id,
                  pathname:
                    normalizedPathname,
                  multipart:
                    multipart === true,
                  clientPayload:
                    safeClientPayload,
                }),
            };
          },

        onUploadCompleted:
          async ({
            blob,
            tokenPayload,
          }) => {
            /*
             * هذه الدالة يتم استدعاؤها من Vercel Blob
             * بعد نجاح الرفع.
             *
             * لا نعتمد على session هنا لأن الطلب
             * يأتي من Vercel Blob وليس من المتصفح.
             */

            console.log(
              "GameVortex wallpaper upload completed:",
              {
                url: blob.url,
                pathname:
                  blob.pathname,
                contentType:
                  blob.contentType,
                tokenPayload:
                  tokenPayload || null,
              },
            );

            /*
             * إنشاء سجل Wallpaper يتم لاحقًا من:
             *
             * /api/admin/wallpapers
             *
             * بعد أن يستلم المتصفح رابط Blob.
             */
          },
      });

    return NextResponse.json(
      response,
      {
        status: 200,
      },
    );
  } catch (error) {
    const message =
      getErrorMessage(error);

    console.error(
      "POST /api/admin/wallpapers/upload failed:",
      {
        message,
        error,
      },
    );

    const status =
      message === "UNAUTHORIZED"
        ? 401
        : 400;

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      {
        status,
      },
    );
  }
}
