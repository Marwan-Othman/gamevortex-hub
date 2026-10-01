import { NextResponse } from "next/server";
import { db } from "../../../../../lib/prisma";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(
  _request: Request,
  { params }: Props,
) {
  try {
    const { id } = await params;

    if (!id || id.length > 100) {
      return NextResponse.json(
        {
          error: "Invalid wallpaper id",
        },
        {
          status: 400,
        },
      );
    }

    const wallpaper = await db.wallpaper.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        published: true,
      },
    });

    if (!wallpaper || !wallpaper.published) {
      return NextResponse.json(
        {
          error: "Wallpaper not found",
        },
        {
          status: 404,
        },
      );
    }

    await db.wallpaper.update({
      where: {
        id: wallpaper.id,
      },
      data: {
        viewCount: {
          increment: 1,
        },
      },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error(
      "Wallpaper view error:",
      error,
    );

    return NextResponse.json(
      {
        error: "Failed to record wallpaper view",
      },
      {
        status: 500,
      },
    );
  }
}
