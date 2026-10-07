import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { refundAiCredit } from "@/lib/ai/credits";
import { getFileState } from "@/lib/ai/media";
import { readMediaToken } from "@/lib/ai/media-token";
import { getAiCost } from "@/lib/ai/costs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const token = request.nextUrl.searchParams.get("token") || "";
  const data = readMediaToken(token);
  if (!data || data.kind !== "VIDEO" || data.sub !== user.id || !data.fileUri) {
    return NextResponse.json({ error: "INVALID_MEDIA_TOKEN" }, { status: 400 });
  }

  try {
    const statePayload = await getFileState(data.fileUri);
    const state = typeof statePayload.state === "string" ? statePayload.state : "PROCESSING";

    if (state === "FAILED") {
      const cost = getAiCost("VIDEO_COST");
      await refundAiCredit(user.id, "VIDEO", data.creditKey, cost).catch(() => undefined);
      return NextResponse.json({ data: { status: "failed" } }, { status: 200 });
    }

    if (state !== "ACTIVE") return NextResponse.json({ data: { status: "processing" } }, { status: 200 });

    return NextResponse.json({
      data: {
        status: "completed",
        videoUrl: "/api/ai/video/file?token=" + encodeURIComponent(token),
      },
    });
  } catch {
    return NextResponse.json({ data: { status: "processing" } }, { status: 200 });
  }
}
