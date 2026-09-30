import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { db } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { generateImage } from "@/lib/ai-media/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROMPT_LENGTH = 4000;

function errorStatus(code: string) {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;

    case "GEMINI_API_KEY_NOT_CONFIGURED":
      return 503;

    case "GEMINI_AUTH_FAILED":
      return 502;

    case "GEMINI_RATE_LIMITED":
      return 429;

    case "GEMINI_IMAGE_TIMEOUT":
      return 504;

    case "GEMINI_IMAGE_BILLING_REQUIRED":
      return 402;

    case "GEMINI_IMAGE_GENERATION_FAILED":
    case "GEMINI_IMAGE_NOT_RETURNED":
    case "GEMINI_INVALID_RESPONSE":
      return 502;

    case "AI_VIDEO_GENERATION_NOT_ENABLED":
      return 503;

    default:
      return 500;
  }
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "AI_MEDIA_GENERATION_FAILED";
}

function dataUrlToBuffer(dataUrl: string) {
  const match = dataUrl.match(
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/,
  );

  if (!match) {
    throw new Error("AI_IMAGE_INVALID_DATA");
  }

  const mimeType = match[1];
  const base64 = match[2];

  const buffer = Buffer.from(base64, "base64");

  if (!buffer.length) {
    throw new Error("AI_IMAGE_EMPTY");
  }

  return {
    buffer,
    mimeType,
  };
}

function extensionForMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";

    case "image/webp":
      return "webp";

    case "image/avif":
      return "avif";

    case "image/png":
    default:
      return "png";
  }
}

function createBlobPath(userId: string, extension: string) {
  return [
    "ai",
    "generated",
    userId,
    `${Date.now()}-${crypto.randomUUID()}.${extension}`,
  ].join("/");
}

export async function GET(req: NextRequest) {
  const user = await getOptionalUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "UNAUTHORIZED",
      },
      {
        status: 401,
      },
    );
  }

  const conversationId = req.nextUrl.searchParams.get(
    "conversationId",
  );

  if (!conversationId) {
    return NextResponse.json({
      jobs: [],
    });
  }

  const jobs = await db.aiMediaJob.findMany({
    where: {
      userId: user.id,
      conversationId,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 100,
    select: {
      id: true,
      kind: true,
      status: true,
      prompt: true,
      resultUrl: true,
      errorMessage: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    jobs,
  });
}

export async function POST(req: NextRequest) {
  const user = await getOptionalUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "UNAUTHORIZED",
      },
      {
        status: 401,
      },
    );
  }

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        error: "INVALID_JSON",
      },
      {
        status: 400,
      },
    );
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json(
      {
        error: "INVALID_REQUEST",
      },
      {
        status: 400,
      },
    );
  }

  const input = body as Record<string, unknown>;

  const kind =
    typeof input.kind === "string"
      ? input.kind
      : "";

  const prompt =
    typeof input.prompt === "string"
      ? input.prompt.trim()
      : "";

  const conversationId =
    typeof input.conversationId === "string" &&
    input.conversationId.trim()
      ? input.conversationId.trim()
      : null;

  const idempotencyKey =
    typeof input.idempotencyKey === "string" &&
    input.idempotencyKey.trim()
      ? input.idempotencyKey.trim()
      : crypto.randomUUID();

  const aspectRatio =
    typeof input.aspectRatio === "string"
      ? input.aspectRatio
      : "9:16";

  if (kind !== "IMAGE") {
    return NextResponse.json(
      {
        error:
          kind === "VIDEO"
            ? "AI_VIDEO_GENERATION_NOT_ENABLED"
            : "AI_MEDIA_KIND_INVALID",
      },
      {
        status:
          kind === "VIDEO"
            ? 503
            : 400,
      },
    );
  }

  if (!prompt) {
    return NextResponse.json(
      {
        error: "AI_IMAGE_PROMPT_REQUIRED",
      },
      {
        status: 400,
      },
    );
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json(
      {
        error: "AI_IMAGE_PROMPT_TOO_LONG",
      },
      {
        status: 400,
      },
    );
  }

  const existing = await db.aiMediaJob.findUnique({
    where: {
      idempotencyKey,
    },
  });

  if (existing) {
    return NextResponse.json({
      job: {
        id: existing.id,
        kind: existing.kind,
        status: existing.status,
        prompt: existing.prompt,
        resultUrl: existing.resultUrl,
        errorMessage: existing.errorMessage,
        createdAt: existing.createdAt,
      },
    });
  }

  if (conversationId) {
    const conversation =
      await db.gameVortexAiConversation.findFirst({
        where: {
          id: conversationId,
          userId: user.id,
        },
        select: {
          id: true,
        },
      });

    if (!conversation) {
      return NextResponse.json(
        {
          error: "CONVERSATION_NOT_FOUND",
        },
        {
          status: 404,
        },
      );
    }
  }

  const job = await db.aiMediaJob.create({
    data: {
      userId: user.id,
      kind: "IMAGE",
      provider: "INTERNAL",
      model:
        process.env.GEMINI_IMAGE_MODEL?.trim() ||
        "gemini-3.1-flash-image",
      prompt,
      status: "PROCESSING",
      conversationId,
      idempotencyKey,
    },
  });

  try {
    const result = await generateImage(
      prompt,
      aspectRatio,
    );

    const {
      buffer,
      mimeType,
    } = dataUrlToBuffer(result.url);

    const extension =
      extensionForMimeType(mimeType);

    let resultUrl = result.url;

    if (
      process.env.BLOB_READ_WRITE_TOKEN?.trim()
    ) {
      try {
        const blob = await put(
          createBlobPath(
            user.id,
            extension,
          ),
          buffer,
          {
            access: "public",
            addRandomSuffix: true,
            contentType: mimeType,
            cacheControlMaxAge: 31536000,
          },
        );

        resultUrl = blob.url;
      } catch (blobError) {
        console.warn(
          "GameVortex AI Blob storage unavailable; using data URL fallback:",
          blobError instanceof Error
            ? blobError.message
            : "UNKNOWN_ERROR",
        );
      }
    }

    const completed =
      await db.aiMediaJob.update({
        where: {
          id: job.id,
        },
        data: {
          status: "COMPLETED",
          resultUrl,
          providerTaskId:
            result.requestId,
          model: result.model,
          errorCode: null,
          errorMessage: null,
        },
        select: {
          id: true,
          kind: true,
          status: true,
          prompt: true,
          resultUrl: true,
          errorMessage: true,
          createdAt: true,
        },
      });

    return NextResponse.json(
      {
        job: completed,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    const code =
      serializeError(error);

    console.error(
      "GameVortex AI image generation failed:",
      {
        jobId: job.id,
        userId: user.id,
        code,
      },
    );

    const failed =
      await db.aiMediaJob.update({
        where: {
          id: job.id,
        },
        data: {
          status: "FAILED",
          errorCode: code,
          errorMessage: code,
        },
        select: {
          id: true,
          kind: true,
          status: true,
          prompt: true,
          resultUrl: true,
          errorMessage: true,
          createdAt: true,
        },
      });

    return NextResponse.json(
      {
        error: code,
        job: failed,
      },
      {
        status: errorStatus(code),
      },
    );
  }
}
