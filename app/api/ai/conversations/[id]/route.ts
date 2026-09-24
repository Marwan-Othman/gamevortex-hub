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

const paramsSchema =
  z.object({
    id: z.string().cuid(),
  });

const renameConversationSchema =
  z.object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(120),
  });


/**
 * GET /api/ai/conversations/[id]
 *
 * Returns one conversation and all of
 * its messages.
 *
 * Ownership is checked server-side.
 */
export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  const blocked =
    await guardRead(
      request,
      "ai:conversation:read",
      120,
    );

  if (blocked) {
    return blocked;
  }

  try {
    const user =
      await requireUser();

    const { id } =
      paramsSchema.parse(
        await params,
      );

    const conversation =
      await db.conversation.findFirst({
        where: {
          id,
          userId: user.id,
        },

        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,

          messages: {
            orderBy: {
              createdAt: "asc",
            },

            select: {
              id: true,
              role: true,
              status: true,
              content: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      });

    if (!conversation) {
      return NextResponse.json(
        {
          success: false,
          error:
            "CONVERSATION_NOT_FOUND",
        },
        {
          status: 404,
        },
      );
    }

    return NextResponse.json({
      success: true,
      data: conversation,
    });
  } catch (error) {
    if (
      error instanceof z.ZodError
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "INVALID_CONVERSATION_ID",
        },
        {
          status: 400,
        },
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : "AI_CONVERSATION_READ_FAILED";

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
          "AI_CONVERSATION_READ_FAILED",
      },
      {
        status: 500,
      },
    );
  }
}


/**
 * PATCH /api/ai/conversations/[id]
 *
 * Currently supports:
 *
 * {
 *   "title": "My conversation"
 * }
 *
 * The conversation must belong to
 * the authenticated user.
 */
export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  const blocked =
    await guardMutation(
      request,
      "ai:conversation:update",
      30,
    );

  if (blocked) {
    return blocked;
  }

  try {
    const user =
      await requireUser();

    const { id } =
      paramsSchema.parse(
        await params,
      );

    const body =
      await request.json();

    const input =
      renameConversationSchema.parse(
        body,
      );

    const existing =
      await db.conversation.findFirst({
        where: {
          id,
          userId: user.id,
        },

        select: {
          id: true,
        },
      });

    if (!existing) {
      return NextResponse.json(
        {
          success: false,
          error:
            "CONVERSATION_NOT_FOUND",
        },
        {
          status: 404,
        },
      );
    }

    const conversation =
      await db.conversation.update({
        where: {
          id,
        },

        data: {
          title: input.title,
        },

        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
        },
      });

    return NextResponse.json({
      success: true,
      data: conversation,
    });
  } catch (error) {
    if (
      error instanceof z.ZodError
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "INVALID_CONVERSATION_TITLE",
        },
        {
          status: 400,
        },
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : "AI_CONVERSATION_UPDATE_FAILED";

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
          "AI_CONVERSATION_UPDATE_FAILED",
      },
      {
        status: 500,
      },
    );
  }
}


/**
 * DELETE /api/ai/conversations/[id]
 *
 * Deletes the conversation belonging
 * to the authenticated user.
 *
 * Messages are deleted automatically
 * because Message -> Conversation uses
 * onDelete: Cascade.
 */
export async function DELETE(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  const blocked =
    await guardMutation(
      request,
      "ai:conversation:delete",
      30,
    );

  if (blocked) {
    return blocked;
  }

  try {
    const user =
      await requireUser();

    const { id } =
      paramsSchema.parse(
        await params,
      );

    const existing =
      await db.conversation.findFirst({
        where: {
          id,
          userId: user.id,
        },

        select: {
          id: true,
        },
      });

    if (!existing) {
      return NextResponse.json(
        {
          success: false,
          error:
            "CONVERSATION_NOT_FOUND",
        },
        {
          status: 404,
        },
      );
    }

    await db.conversation.delete({
      where: {
        id,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        id,
        deleted: true,
      },
    });
  } catch (error) {
    if (
      error instanceof z.ZodError
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "INVALID_CONVERSATION_ID",
        },
        {
          status: 400,
        },
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : "AI_CONVERSATION_DELETE_FAILED";

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
          "AI_CONVERSATION_DELETE_FAILED",
      },
      {
        status: 500,
      },
    );
  }
}
