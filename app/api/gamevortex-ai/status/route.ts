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
    const { healthUrl, local, model } = getRuntimeConfig();
    const response = await fetch(healthUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    const health = await response.json().catch(() => ({}));
    const modelAvailable = local
      ? Array.isArray(health.models) && health.models.some((entry: { name?: string; model?: string }) => entry.name === model || entry.model === model)
      : health.ok === true && health.modelReady === true;
    const status = response.ok && modelAvailable
      ? "ready"
      : health.runtimeAvailable === true || (local && response.ok)
        ? "model_missing"
        : "offline";
    return NextResponse.json({ data: { status } });
  } catch (error) {
    const status = error instanceof Error && [
      "RUNTIME_NOT_CONFIGURED",
      "RUNTIME_TOKEN_NOT_CONFIGURED",
      "RUNTIME_CONFIGURATION_INVALID",
    ].includes(error.message)
      ? "not_configured"
      : "offline";
    return NextResponse.json({ data: { status } });
  }
}