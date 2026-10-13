import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Image generation is intentionally disabled; wallpaper browsing and editing remain available. */
export async function POST(request: NextRequest) {
  try {
    const user = await getOptionalUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });

    const blocked = await guardMutation(request);
    if (blocked) return blocked;

    return NextResponse.json(
      { error: "AI_IMAGE_DISABLED", message: "إنشاء الصور بالذكاء الاصطناعي متوقف. يمكنك استخدام خلفيات GameVortex وتعديلها." },
      { status: 410, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "AI_SERVICE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "5" } });
  }
}
