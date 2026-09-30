import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardRead } from "@/lib/api";
import { getRuntimeConfig } from "@/lib/gamevortex-ai/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "gamevortex-ai:status", 30);
  if (blocked) return blocked;

  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  try {
    getRuntimeConfig();
    return NextResponse.json({ data: { status: "ready" } });
  } catch {
    return NextResponse.json({ data: { status: "not_configured" } });
  }
}
