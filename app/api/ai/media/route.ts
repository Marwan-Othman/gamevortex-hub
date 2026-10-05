import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { db } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";
import { getVipAccess } from "@/lib/vip";
import { consumeAiCredit, refundAiCredit } from "@/lib/ai-media/credits";
import { getImageCost } from "@/lib/ai-media/costs";
import { generateImage } from "@/lib/ai-media/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_PROMPT_LENGTH = 4000;
const MAX_INPUT_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_GENERATED_IMAGE_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function errorStatus(code: string) {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;

    case "AI_VIP_REQUIRED":
      return 403;

    case "AI_CREDITS_EXHAUSTED":
      return 402;

    case "AI_IDEMPOTENCY_KEY_OWNED_BY_OTHER_USER":
      return 409;

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
  const message = error instanceof Error ? error.message : "";
  return new Set(["UNAUTHORIZED","AI_VIP_REQUIRED","AI_CREDITS_EXHAUSTED","AI_IDEMPOTENCY_KEY_OWNED_BY_OTHER_USER","GEMINI_API_KEY_NOT_CONFIGURED","GEMINI_AUTH_FAILED","GEMINI_RATE_LIMITED","GEMINI_IMAGE_TIMEOUT","GEMINI_IMAGE_BILLING_REQUIRED","GEMINI_IMAGE_GENERATION_FAILED","GEMINI_IMAGE_NOT_RETURNED","GEMINI_INVALID_RESPONSE","AI_VIDEO_GENERATION_NOT_ENABLED","AI_IMAGE_INVALID_DATA","AI_IMAGE_EMPTY","AI_IMAGE_TOO_LARGE","AI_IMAGE_TYPE_NOT_SUPPORTED","AI_IMAGE_PROMPT_REQUIRED","AI_IMAGE_PROMPT_TOO_LONG","AI_MEDIA_KIND_INVALID","CONVERSATION_NOT_FOUND"]).has(message) ? message : "AI_MEDIA_GENERATION_FAILED";
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

  if (buffer.length > MAX_GENERATED_IMAGE_BYTES) {
    throw new Error("AI_IMAGE_TOO_LARGE");
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
  const blocked = await guardRead(req, "ai-media:read", 120);
  if (blocked) return blocked;
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
  const blocked = await guardMutation(req, "ai-media:generate", 6);
  if (blocked) return blocked;
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

  let input: Record<string, unknown>;
  let uploadedImage: { base64: string; mimeType: string } | undefined;

  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      input = Object.fromEntries(form.entries());
      const file = form.get("image");
      if (file instanceof File && file.size > 0) {
        if (!ALLOWED_IMAGE_TYPES.has(file.type)) return NextResponse.json({ error: "AI_IMAGE_TYPE_NOT_SUPPORTED" }, { status: 400 });
        if (file.size > MAX_INPUT_IMAGE_BYTES) return NextResponse.json({ error: "AI_IMAGE_TOO_LARGE" }, { status: 413 });
        uploadedImage = { base64: Buffer.from(await file.arrayBuffer()).toString("base64"), mimeType: file.type };
      }
    } else {
      const body: unknown = await req.json();
      if (!body || typeof body !== "object") return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
      input = body as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

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

  const operation =
    input.operation === "EDIT" ||
    input.operation === "ENHANCE" ||
    input.operation === "TRANSFORM"
      ? input.operation
      : "EDIT";
  const creditAmount = getImageCost(
    operation === "EDIT" && !uploadedImage ? "GENERATE" : operation,
    typeof input.quality === "string" ? input.quality : undefined,
  );

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
    if (existing.userId !== user.id) {
      return NextResponse.json(
        { error: "AI_IDEMPOTENCY_KEY_OWNED_BY_OTHER_USER" },
        { status: 409 },
      );
    }
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

  const vip = await getVipAccess(user.id);
  if (!vip.isVip) {
    return NextResponse.json({ error: "AI_VIP_REQUIRED" }, { status: 403 });
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

  await consumeAiCredit(user.id, "IMAGE", idempotencyKey, creditAmount);

  let job;
  try {
    job = await db.aiMediaJob.create({
      data: {
        userId: user.id,
        kind: "IMAGE",
        provider: "INTERNAL",
        model:
          process.env.GEMINI_IMAGE_MODEL?.trim() ||
          "gemini-3.1-flash-image",
        prompt: `[${operation}] ${prompt}`,
        status: "PROCESSING",
        conversationId,
        idempotencyKey,
      },
    });
  } catch (error) {
    await refundAiCredit(user.id, "IMAGE", idempotencyKey, creditAmount).catch(() => undefined);
    throw error;
  }

  try {
    const operationInstruction =
      operation === "ENHANCE"
        ? "Enhance the uploaded image quality while preserving its identity, composition, and subject. "
        : operation === "TRANSFORM"
          ? "Transform the uploaded image according to the user's requested style or visual direction while preserving the important subject. "
          : "Edit the uploaded image according to the user's requested changes. ";

    const result = await generateImage(
      uploadedImage
        ? `${operationInstruction}${prompt}`
        : prompt,
      aspectRatio,
      uploadedImage,
    );

    const {
      buffer,
      mimeType,
    } = dataUrlToBuffer(result.url);

    const extension =
      extensionForMimeType(mimeType);

    let resultUrl = result.url;

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
    await refundAiCredit(user.id, "IMAGE", idempotencyKey, creditAmount).catch(() => undefined);
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
