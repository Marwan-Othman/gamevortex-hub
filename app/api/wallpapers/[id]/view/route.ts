import { NextResponse } from "next/server";
import { db } from "../../../../../lib/prisma";
import { clientKey, rateLimitAsync } from "../../../../../lib/security";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(
  request: Request,
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

    // Anonymous endpoint: count at most one view per client per wallpaper every
    // 10 minutes (and cap overall volume) so the counter cannot be inflated by a loop.
    const overall = await rateLimitAsync(clientKey(request, "wallpapers:view"), 120, 60_000);
    if (!overall.allowed) {
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(overall.retryAfter) } });
    }
    const perItem = await rateLimitAsync(clientKey(request, `wallpapers:view:${id}`), 1, 10 * 60_000);
    if (!perItem.allowed) {
      return NextResponse.json({ success: true, counted: false });
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
      counted: true,
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
