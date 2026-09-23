import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-keys";

/*
 * Master Task Plan Section 3, item 1 — "نظام API خاص بالموقع".
 * This is the first real endpoint of GameVortex's own external API:
 * a working proof that a purchased key (item 2) actually grants
 * access. Further endpoints (catalog search, entitlement checks,
 * etc.) can be added the same way — just call requireApiKey(req)
 * at the top of each one.
 */
export async function GET(req: Request) {
  const result = await requireApiKey(req);

  if (!result.valid) {
    const status =
      result.reason === "MISSING" ? 401 : 403;

    return NextResponse.json(
      { error: `API_KEY_${result.reason}` },
      { status },
    );
  }

  return NextResponse.json({
    ok: true,
    message: "GameVortex API is reachable.",
    apiKeyId: result.apiKeyId,
  });
}
