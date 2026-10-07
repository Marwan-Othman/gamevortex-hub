import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { refundAiCredit } from "@/lib/ai/credits";
import { createMediaToken, readMediaToken } from "@/lib/ai/media-token";
import { getCompletedVideoUri, getVideoOperation } from "@/lib/ai/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const token = request.nextUrl.searchParams.get("token") || "";
  const data = readMediaToken(token);
  if (!data || data.kind !== "VIDEO" || data.sub !== user.id || data.fileUri) {
    return NextResponse.json({ error: "INVALID_MEDIA_TOKEN" }, { status: 400 });
  }

  try {
    const operation = await getVideoOperation(data.interactionId);
    const done = operation.done === true;

    if (!done) {
      return NextResponse.json({ data: { status: "processing" } }, { status: 200 });
    }

    if (operation.error && typeof operation.error === "object") {
      await refundAiCredit(user.id, "VIDEO", data.creditKey, data.creditAmount).catch(() => undefined);
      return NextResponse.json({ data: { status: "failed" } }, { status: 200 });
    }

    const fileUri = getCompletedVideoUri(operation);
    if (!fileUri) {
      await refundAiCredit(user.id, "VIDEO", data.creditKey, data.creditAmount).catch(() => undefined);
      return NextResponse.json({ data: { status: "failed" } }, { status: 200 });
    }

    const completedToken = createMediaToken({
      sub: user.id,
      interactionId: data.interactionId,
      fileUri,
      kind: "VIDEO",
      creditKey: data.creditKey,
      creditAmount: data.creditAmount,
      ttlSeconds: 60 * 60,
    });

    return NextResponse.json({
      data: {
        status: "completed",
        videoUrl: "/api/ai/video/file?token=" + encodeURIComponent(completedToken),
      },
    });
  } catch {
    return NextResponse.json({ data: { status: "processing" } }, { status: 200 });
  }
}
