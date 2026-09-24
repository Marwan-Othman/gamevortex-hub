import {
  NextRequest,
  NextResponse,
} from "next/server";

import { z } from "zod";

import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import {
  guardMutation,
  guardRead,
} from "@/lib/api";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

const createConversationSchema =
  z.object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional(),
  });

/**
 * GET /api/ai/conversations
 *
 * Returns only conversations owned by
 * the currently authenticated user.
 */
export async function GET(
  request: NextRequest,
) {
  const blocked =
    await guardRead(
      request,
      "ai:conversations:read",
      120,
    );

  if (blocked) {
    return blocked;
  }

  try {
    const user =
      await requireUser();

    const conversations =
      await db.conversation.findMany({
        where: {
          userId: user.id,
        },

        orderBy: [
          {
            updatedAt: "desc",
          },
          {
            createdAt: "desc",
          },
        ],

        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,

          _count: {
            select: {
              messages: true,
            },
          },
        },
      });

    return NextResponse.json({
      success: true,
      data: conversations,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "AI_CONVERSATIONS_READ_FAILED";

    if (
      message === "UNAUTHORIZED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "UNAUTHORIZED",
        },
        {
          status: 401,
        },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          "AI_CONVERSATIONS_READ_FAILED",
      },
      {
        status: 500,
      },
    );
  }
}


/**
 * POST /api/ai/conversations
 *
 * Creates a conversation for the
 * currently authenticated user.
 *
 * userId is NEVER accepted from the client.
 */
export async function POST(
  request: NextRequest,
) {
  const blocked =
    await guardMutation(
      request,
      "ai:conversations:create",
      30,
    );

  if (blocked) {
    return blocked;
  }

  try {
    const user =
      await requireUser();

    let body: unknown = {};

    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const input =
      createConversationSchema.parse(
        body,
      );

    const conversation =
      await db.conversation.create({
        data: {
          userId: user.id,

          title:
            input.title ??
            "New Chat",
        },

        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
        },
      });

    return NextResponse.json(
      {
        success: true,
        data: conversation,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    if (
      error instanceof z.ZodError
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "INVALID_CONVERSATION_INPUT",
        },
        {
          status: 400,
        },
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : "AI_CONVERSATION_CREATE_FAILED";

    if (
      message === "UNAUTHORIZED"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "UNAUTHORIZED",
        },
        {
          status: 401,
        },
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          "AI_CONVERSATION_CREATE_FAILED",
      },
      {
        status: 500,
      },
    );
  }
          }
