import { NextRequest, NextResponse } from "next/server";
import dns from "node:dns/promises";
import net from "node:net";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { normalizeWallpaperTags } from "@/lib/wallpapers";
import { guardMutation, guardRead } from "@/lib/api";
import {
  WALLPAPER_MAX_FILE_SIZE,
  filenameFromUrl,
  isAnimatedWallpaperMimeType,
  isSupportedWallpaperMimeType,
  isVercelBlobUrl,
  sanitizeWallpaperFilename,
  storeWallpaperFile,
} from "@/lib/wallpaper-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_URL_LENGTH = 4000;
const MAX_BULK_DELETE = 500;

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function serializeWallpaper<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as T;
}

async function requireSuperAdmin() {
  const user = await getOptionalUser();

  return user?.role === "SUPER_ADMIN" ? user : null;
}

function cleanString(
  value: unknown,
  max = 5000,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();

  return cleaned ? cleaned.slice(0, max) : null;
}

function createWallpaperSlug() {
  return `wallpaper-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function detectType(
  width: number | null,
  height: number | null,
): "MOBILE" | "DESKTOP" {
  if (width && height && height > width) {
    return "MOBILE";
  }

  return "DESKTOP";
}

function isPrivateIpv4(ip: string) {
  const parts = ip.split(".").map(Number);

  if (
    parts.length !== 4 ||
    parts.some(
      (part) =>
        !Number.isInteger(part) ||
        part < 0 ||
        part > 255,
    )
  ) {
    return false;
  }

  const [a, b] = parts;

  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 ||
    a === 0
  );
}

function isPrivateIpv6(ip: string) {
  const value = ip.toLowerCase();

  const mapped = value.match(
    /^::ffff:(\d+\.\d+\.\d+\.\d+)$/,
  );

  if (mapped) {
    return isPrivateIpv4(mapped[1]);
  }

  return (
    value === "::1" ||
    value === "::" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb")
  );
}

async function assertSafeRemoteUrl(
  value: string,
) {
  const url = new URL(value);

  if (url.protocol !== "https:") {
    throw new Error("IMAGE_URL_MUST_BE_HTTPS");
  }

  if (url.username || url.password) {
    throw new Error(
      "IMAGE_URL_CANNOT_CONTAIN_CREDENTIALS",
    );
  }

  const hostname = url.hostname.toLowerCase();

  if (
    [
      "localhost",
      "localhost.localdomain",
      "0.0.0.0",
    ].includes(hostname) ||
    hostname.endsWith(".local")
  ) {
    throw new Error("IMAGE_URL_HOST_NOT_ALLOWED");
  }

  if (net.isIP(hostname)) {
    if (
      (net.isIP(hostname) === 4 &&
        isPrivateIpv4(hostname)) ||
      (net.isIP(hostname) === 6 &&
        isPrivateIpv6(hostname))
    ) {
      throw new Error("IMAGE_URL_HOST_NOT_ALLOWED");
    }

    return;
  }

  const records = await dns.lookup(hostname, {
    all: true,
  });

  if (!records.length) {
    throw new Error("IMAGE_URL_HOST_NOT_RESOLVED");
  }

  for (const record of records) {
    if (
      (record.family === 4 &&
        isPrivateIpv4(record.address)) ||
      (record.family === 6 &&
        isPrivateIpv6(record.address))
    ) {
      throw new Error("IMAGE_URL_HOST_NOT_ALLOWED");
    }
  }
}

async function importRemoteWallpaper(
  sourceUrl: string,
) {
  let currentUrl = sourceUrl;

  let response: Response | null = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await assertSafeRemoteUrl(currentUrl);

    response = await fetch(currentUrl, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(300_000),
      headers: {
        accept:
          "image/jpeg,image/png,image/webp,image/gif,image/apng,image/avif;q=0.9,*/*;q=0.1",
        "user-agent":
          "GameVortex-Wallpaper-Importer/1.0",
      },
    });

    if (
      response.status >= 300 &&
      response.status < 400
    ) {
      const location =
        response.headers.get("location");

      if (!location) {
        throw new Error(
          "IMAGE_SOURCE_REDIRECT_INVALID",
        );
      }

      currentUrl = new URL(
        location,
        currentUrl,
      ).toString();

      continue;
    }

    break;
  }

  if (!response || !response.ok) {
    throw new Error(
      `IMAGE_SOURCE_FETCH_FAILED_${
        response?.status || 0
      }`,
    );
  }

  const contentType = (
    response.headers.get("content-type") || ""
  )
    .split(";", 1)[0]
    .trim()
    .toLowerCase();

  if (
    !isSupportedWallpaperMimeType(
      contentType,
    )
  ) {
    throw new Error(
      "IMAGE_SOURCE_TYPE_NOT_SUPPORTED",
    );
  }

  if (!response.body) {
    throw new Error("IMAGE_FILE_EMPTY");
  }

  let size = 0;

  const counter = new TransformStream<
    Uint8Array,
    Uint8Array
  >({
    transform(chunk, controller) {
      size += chunk.byteLength;

      if (size > WALLPAPER_MAX_FILE_SIZE) {
        throw new Error(
          "IMAGE_FILE_TOO_LARGE",
        );
      }

      controller.enqueue(chunk);
    },
  });

  const filename = filenameFromUrl(
    sourceUrl,
    `wallpaper-${Date.now()}`,
  );

  const stored = await storeWallpaperFile({
    pathname: `wallpapers/imported/${Date.now()}-${sanitizeWallpaperFilename(
      filename,
    )}`,
    file: response.body.pipeThrough(counter),
    contentType,
  });

  if (size === 0) {
    await del(stored.url).catch(
      () => undefined,
    );

    throw new Error("IMAGE_FILE_EMPTY");
  }

  return {
    url: stored.url,
    filename,
    mimeType: contentType,
    size,
    isAnimated:
      isAnimatedWallpaperMimeType(
        contentType,
      ),
    sourceUrl,
  };
}

export async function GET(
  request: NextRequest,
) {
  const guard = await guardRead(request, "admin-wallpapers-read");
  if (guard) return guard;

  const user = await requireSuperAdmin();

  if (!user) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized",
      },
      { status: 401 },
    );
  }

  const { searchParams } =
    new URL(request.url);

  const typeValue =
    searchParams.get("type");

  const type =
    typeValue === "MOBILE" ||
    typeValue === "DESKTOP"
      ? typeValue
      : undefined;

  const vipValue =
    searchParams.get("vip");

  const isVip =
    vipValue === "true"
      ? true
      : vipValue === "false"
        ? false
        : undefined;

  const wallpapers =
    await prisma.wallpaper.findMany({
      where: {
        ...(type ? { type } : {}),
        ...(isVip !== undefined
          ? { isVip }
          : {}),
      },

      orderBy: [
        {
          sortOrder: "asc",
        },
        {
          createdAt: "desc",
        },
      ],

      take: 500,
    });

  return NextResponse.json({
    success: true,
    data: serializeWallpaper(
      wallpapers,
    ),
  });
}

export async function POST(
  request: NextRequest,
) {
  const guard = await guardMutation(request, "admin-wallpapers");
  if (guard) return guard;
  const user =
    await requireSuperAdmin();

  if (!user) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized",
      },
      { status: 401 },
    );
  }

  try {
    const parsedBody: unknown =
      await request.json();

    if (!isJsonRecord(parsedBody)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
        },
        { status: 400 },
      );
    }

    const body = parsedBody;

    const sourceType =
      body.sourceType === "URL"
        ? "URL"
        : "BLOB";

    let file = {
      url: "",
      filename: "wallpaper",
      mimeType: "image/jpeg",
      size: 0,
      isAnimated: false,
      sourceUrl: null as string | null,
    };

    if (sourceType === "URL") {
      const sourceUrl = cleanString(
        body.sourceUrl,
        MAX_URL_LENGTH,
      );

      if (!sourceUrl) {
        return NextResponse.json(
          {
            success: false,
            error: "رابط الصورة مطلوب",
          },
          { status: 400 },
        );
      }

      file =
        await importRemoteWallpaper(
          sourceUrl,
        );
    } else {
      const imageUrl = cleanString(
        body.imageUrl,
        MAX_URL_LENGTH,
      );

      if (
        !imageUrl ||
        !isVercelBlobUrl(imageUrl)
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "يجب رفع الملف أولًا إلى تخزين GameVortex.",
          },
          { status: 400 },
        );
      }

      const mimeType =
        cleanString(
          body.mimeType,
          120,
        )?.toLowerCase() || "";

      if (
        !isSupportedWallpaperMimeType(
          mimeType,
        )
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "صيغة الصورة غير مدعومة.",
          },
          { status: 400 },
        );
      }

      const size = Number(
        body.fileSizeBytes || 0,
      );

      if (
        !Number.isFinite(size) ||
        size <= 0 ||
        size > WALLPAPER_MAX_FILE_SIZE
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "حجم الملف غير صالح أو أكبر من الحد المسموح.",
          },
          { status: 400 },
        );
      }

      file = {
        url: imageUrl,

        filename:
          sanitizeWallpaperFilename(
            cleanString(
              body.originalFilename,
              160,
            ) || "wallpaper",
          ),

        mimeType,

        size,

        isAnimated:
          body.isAnimated === true ||
          isAnimatedWallpaperMimeType(
            mimeType,
          ),

        sourceUrl: null,
      };
    }

    const width =
      Number.isInteger(body.width) &&
      Number(body.width) > 0
        ? Math.min(
            Number(body.width),
            100000,
          )
        : null;

    const height =
      Number.isInteger(body.height) &&
      Number(body.height) > 0
        ? Math.min(
            Number(body.height),
            100000,
          )
        : null;

    const type =
      body.type === "MOBILE" ||
      body.type === "DESKTOP"
        ? body.type
        : detectType(
            width,
            height,
          );

    const orientation =
      width && height
        ? width === height
          ? "SQUARE"
          : width > height
            ? "LANDSCAPE"
            : "PORTRAIT"
        : type === "MOBILE"
          ? "PORTRAIT"
          : "LANDSCAPE";

    const resolution =
      width && height
        ? `${width}x${height}`
        : null;

    const wallpaper =
      await prisma.wallpaper.create({
        data: {
          titleAr:
            "خلفية GameVortex",

          titleEn:
            "GameVortex Wallpaper",

          slug:
            createWallpaperSlug(),

          descriptionAr: null,

          descriptionEn: null,

          imageUrl: file.url,

          thumbnailUrl: null,

          downloadUrl: null,

          originalFilename:
            file.filename,

          mimeType:
            file.mimeType,

          fileSizeBytes:
            file.size,

          isAnimated:
            file.isAnimated,

          mediaUrl: null,

          mediaType: "IMAGE",

          durationSeconds: null,

          sourceUrl:
            file.sourceUrl,

          sourceProvider:
            sourceType === "URL"
              ? "IMPORTED_TO_GAMEVORTEX"
              : "GAMEVORTEX_BLOB",

          licenseUrl: null,

          licenseStatus: null,

          attribution: null,

          sourceStatus:
            "OFFICIAL_SOURCE",

          type,

          orientation,

          deviceType: type,

          category: "GAMING",

          /*
           * مهم:
           * normalizeWallpaperTags يجب أن يعيد
           * string[] حتى لا ينتج unknown[].
           */
          tags:
            normalizeWallpaperTags(
              [] as string[],
            ),

          width,

          height,

          resolution,

          isVip:
            body.isVip === true,

          published:
            body.published === true,

          featured:
            body.featured === true,

          sortOrder: 0,

          uploadedById:
            user.id,

          moderationStatus:
            "APPROVED",
        },
      });

    return NextResponse.json(
      {
        success: true,
        data: serializeWallpaper(
          wallpaper,
        ),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error(
      "POST /api/admin/wallpapers error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to create wallpaper",
      },
      { status: 400 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
) {
  const guard = await guardMutation(request, "admin-wallpapers");
  if (guard) return guard;
  const user = await requireSuperAdmin();

  if (!user) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const parsedBody: unknown = await request.json();
    if (!isJsonRecord(parsedBody)) {
      return NextResponse.json(
        { success: false, error: "Invalid request body" },
        { status: 400 },
      );
    }

    const rawIds = parsedBody.ids;
    const singleId = typeof parsedBody.id === "string" ? parsedBody.id.trim() : "";
    const ids = Array.from(new Set<string>([
      ...(Array.isArray(rawIds)
        ? rawIds.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean)
        : []),
      ...(singleId ? [singleId] : []),
    ])).slice(0, 100);

    if (!ids.length) {
      return NextResponse.json(
        { success: false, error: "Wallpaper id is required" },
        { status: 400 },
      );
    }

    const data: {
      published?: boolean;
      featured?: boolean;
      isVip?: boolean;
      category?: string;
      type?: "MOBILE" | "DESKTOP";
    } = {};

    if (typeof parsedBody.published === "boolean") data.published = parsedBody.published;
    if (typeof parsedBody.featured === "boolean") data.featured = parsedBody.featured;
    if (typeof parsedBody.isVip === "boolean") data.isVip = parsedBody.isVip;

    const category = typeof parsedBody.category === "string"
      ? parsedBody.category.trim().toUpperCase()
      : "";
    if (category) {
      const allowed = new Set([
        "GAMING","ANIME","CYBERPUNK","CARS","NATURE","SPACE","FANTASY","ARABIC",
        "ISLAMIC","ABSTRACT","MINIMAL","TECHNOLOGY","AI","NEON","GAMEVORTEX","SPORTS","OTHER",
      ]);
      if (!allowed.has(category)) {
        return NextResponse.json(
          { success: false, error: "Invalid wallpaper category" },
          { status: 400 },
        );
      }
      data.category = category;
    }

    if (parsedBody.type === "MOBILE" || parsedBody.type === "DESKTOP") {
      data.type = parsedBody.type;
    }

    if (!Object.keys(data).length) {
      return NextResponse.json(
        { success: false, error: "No supported fields to update" },
        { status: 400 },
      );
    }

    const existing = await prisma.wallpaper.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });

    if (!existing.length) {
      return NextResponse.json(
        { success: false, error: "Wallpaper not found" },
        { status: 404 },
      );
    }

    await prisma.wallpaper.updateMany({
      where: { id: { in: existing.map((item) => item.id) } },
      data,
    });

    const updated = await prisma.wallpaper.findMany({
      where: { id: { in: existing.map((item) => item.id) } },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      success: true,
      data: serializeWallpaper(updated),
    });
  } catch (error) {
    console.error("PATCH /api/admin/wallpapers error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update wallpaper" },
      { status: 500 },
    );
  }
}

/*
 * DELETE
 *
 * حذف خلفية واحدة:
 * DELETE /api/admin/wallpapers?id=xxx
 *
 * حذف عدة خلفيات:
 * DELETE /api/admin/wallpapers
 *
 * Body:
 * {
 *   "ids": ["id1", "id2", "id3"]
 * }
 */
export async function DELETE(
  request: NextRequest,
) {
  const guard = await guardMutation(request, "admin-wallpapers");
  if (guard) return guard;
  const user =
    await requireSuperAdmin();

  if (!user) {
    return NextResponse.json(
      {
        success: false,
        error: "Unauthorized",
      },
      { status: 401 },
    );
  }

  try {
    const contentType =
      request.headers.get(
        "content-type",
      ) || "";

    /*
     * حذف فردي
     */
    if (
      !contentType
        .toLowerCase()
        .includes(
          "application/json",
        )
    ) {
      const id =
        new URL(
          request.url,
        ).searchParams
          .get("id")
          ?.trim();

      if (!id) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Wallpaper id is required",
          },
          { status: 400 },
        );
      }

      const wallpaper =
        await prisma.wallpaper.findUnique({
          where: { id },

          select: {
            id: true,
            imageUrl: true,
          },
        });

      if (!wallpaper) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Wallpaper not found",
          },
          { status: 404 },
        );
      }

      await prisma.wallpaper.delete({
        where: { id },
      });

      if (
        isVercelBlobUrl(
          wallpaper.imageUrl,
        )
      ) {
        try {
          await del(
            wallpaper.imageUrl,
          );
        } catch (error) {
          console.error(
            "Wallpaper Blob delete failed:",
            error,
          );
        }
      }

      return NextResponse.json({
        success: true,
        deletedIds: [id],
      });
    }

    /*
     * حذف جماعي
     */
    const parsedBody: unknown =
      await request.json();

    if (!isJsonRecord(parsedBody)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Invalid request body",
        },
        { status: 400 },
      );
    }

    /*
     * هنا تحديدًا تم إصلاح الخطأ الذي
     * كان يوقف Vercel build.
     *
     * لا نسمح لـ unknown[] بالدخول إلى
     * Prisma أو Set.
     */
    const rawIds: unknown =
      parsedBody.ids;

    const ids: string[] =
      Array.isArray(rawIds)
        ? rawIds
            .filter(
              (
                value: unknown,
              ): value is string =>
                typeof value ===
                "string",
            )
            .map(
              (value: string) =>
                value.trim(),
            )
            .filter(
              (
                value: string,
              ): value is string =>
                value.length > 0,
            )
        : [];

    /*
     * إزالة التكرارات مع بقاء النوع
     * string[] بشكل صريح.
     */
    const uniqueIds: string[] =
      Array.from(
        new Set<string>(ids),
      ).slice(
        0,
        MAX_BULK_DELETE,
      );

    if (!uniqueIds.length) {
      return NextResponse.json(
        {
          success: false,
          error:
            "لم يتم تحديد أي خلفيات.",
        },
        { status: 400 },
      );
    }

    /*
     * جلب السجلات قبل الحذف حتى نعرف
     * روابط ملفات Vercel Blob.
     */
    const wallpapers =
      await prisma.wallpaper.findMany({
        where: {
          id: {
            in: uniqueIds,
          },
        },

        select: {
          id: true,
          imageUrl: true,
        },
      });

    if (!wallpapers.length) {
      return NextResponse.json(
        {
          success: false,
          error:
            "لم يتم العثور على الخلفيات المحددة.",
        },
        { status: 404 },
      );
    }

    const foundIds: string[] =
      wallpapers.map(
        (
          wallpaper,
        ): string => wallpaper.id,
      );

    /*
     * حذف السجلات من PostgreSQL
     */
    await prisma.wallpaper.deleteMany({
      where: {
        id: {
          in: foundIds,
        },
      },
    });

    /*
     * جمع روابط Blob فقط.
     *
     * النوع هنا string[] بشكل صريح.
     */
    const blobUrls: string[] =
      wallpapers
        .map(
          (
            wallpaper,
          ): string =>
            wallpaper.imageUrl,
        )
        .filter(
          (
            url: string,
          ): boolean =>
            isVercelBlobUrl(url),
        );

    /*
     * حذف الملفات من Vercel Blob.
     */
    const blobResults =
      await Promise.allSettled(
        blobUrls.map(
          (
            url: string,
          ) => del(url),
        ),
      );

    const failedBlobDeletes =
      blobResults.filter(
        (
          result,
        ) =>
          result.status ===
          "rejected",
      ).length;

    if (failedBlobDeletes) {
      console.error(
        `Bulk wallpaper Blob cleanup failed for ${failedBlobDeletes} file(s).`,
      );
    }

    return NextResponse.json({
      success: true,

      deletedIds: foundIds,

      deletedCount:
        foundIds.length,

      failedBlobDeletes,
    });
  } catch (error) {
    console.error(
      "DELETE /api/admin/wallpapers error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete wallpaper(s)",
      },
      { status: 500 },
    );
  }
}
