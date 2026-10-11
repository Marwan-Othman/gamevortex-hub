import { NextResponse } from "next/server";
import { enabledOAuthProviders } from "@/lib/auth/oauth";
import { internalError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ success: true, data: enabledOAuthProviders() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return internalError("auth:oauth:providers", error, "OAUTH_PROVIDERS_FAILED");
  }
}
