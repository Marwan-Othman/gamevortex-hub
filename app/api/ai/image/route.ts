import { NextRequest, NextResponse } from "next/server";
import { guardMutation } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Image generation is intentionally disabled; wallpaper browsing and editing remain available. */
export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request);
  if (blocked) return blocked;

  return NextResponse.json(
    { error: "AI_IMAGE_DISABLED", message: "إنشاء الصور بالذكاء الاصطناعي متوقف. يمكنك استخدام خلفيات GameVortex وتعديلها." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
