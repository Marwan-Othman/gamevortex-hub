import { NextResponse } from "next/server";
import { enabledOAuthProviders } from "@/lib/auth/oauth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ success: true, data: enabledOAuthProviders() }, { headers: { "Cache-Control": "no-store" } });
}
