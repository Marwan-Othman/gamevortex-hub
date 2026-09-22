import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { ChatMessageStatus } from "@prisma/client";

import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { db } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(64);

function json(
  data: Record<string, unknown>,
  status = 200,
) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function PATCH(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  const guard = await guardMutation(
    request,
    "ai:message:stop",
    30,
  );

  if (guard) {
    return guard;
  }

  try {
    const user = await getOptionalUser();

    if (!user) {
      return json(
        {
          error: "UNAUTHORIZED",
        },
        401,
      );
    }

    const params = await context.params;

    const parsedId =
      idSchema.safeParse(params.id);

    if (!parsedId.success) {
      return json(
        {
          error: "INVALID_MESSAGE_ID",
        },
        400,
      );
    }

    const messageId = parsedId.data;

    const body =
      await request.json().catch(() => ({}));

    const action =
      typeof body?.action === "string"
        ? body.action.trim().toLowerCase()
        : "stop";

    if (action !== "stop") {
      return json(
        {
          error: "INVALID_ACTION",
        },
        400,
      );
    }

    const message =
      await db.message.findUnique({
        where: {
          id: messageId,
        },
        select: {
          id: true,
          conversationId: true,
          role: true,
          status: true,
          content: true,
          conversation: {
            select: {
              userId: true,
            },
          },
        },
      });

    if (!message) {
      return json(
        {
          error: "MESSAGE_NOT_FOUND",
        },
        404,
      );
    }

    if (
      message.conversation.userId !==
      user.id
    ) {
      return json(
        {
          error: "MESSAGE_NOT_FOUND",
        },
        404,
      );
    }

    if (message.role !== "ASSISTANT") {
      return json(
        {
          error: "MESSAGE_NOT_ASSISTANT",
        },
        400,
      );
    }

    if (
      message.status !==
        ChatMessageStatus.PENDING &&
      message.status !==
        ChatMessageStatus.STREAMING
    ) {
      return json(
        {
          error: "MESSAGE_NOT_RUNNING",
          status: message.status,
        },
        409,
      );
    }

    const updated =
      await db.message.updateMany({
        where: {
          id: message.id,
          conversation: {
            userId: user.id,
          },
          status: {
            in: [
              ChatMessageStatus.PENDING,
              ChatMessageStatus.STREAMING,
            ],
          },
        },
        data: {
          status:
            ChatMessageStatus.STOPPED,
          updatedAt: new Date(),
        },
      });

    if (updated.count !== 1) {
      const current =
        await db.message.findUnique({
          where: {
            id: message.id,
          },
          select: {
            status: true,
          },
        });

      return json(
        {
          error: "MESSAGE_NOT_RUNNING",
          status:
            current?.status ??
            ChatMessageStatus.STOPPED,
        },
        409,
      );
    }

    const stopped =
      await db.message.findUnique({
        where: {
          id: message.id,
        },
        select: {
          id: true,
          conversationId: true,
          role: true,
          status: true,
          content: true,
          createdAt: true,
          updatedAt: true,
        },
      });

    return json({
      ok: true,
      message: stopped,
    });
  } catch (error) {
    console.error(
      "AI_MESSAGE_STOP_ERROR",
      error,
    );

    return json(
      {
        error: "AI_MESSAGE_STOP_FAILED",
      },
      500,
    );
  }
}
