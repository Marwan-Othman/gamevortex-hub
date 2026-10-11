import { NextRequest, NextResponse } from "next/server";
import { getFazerCardsBalance, getFazerCardsMe } from "@/lib/integrations/fazercards";
import { requireOwner } from "@/lib/auth";
import { guardRead } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:fazercards:test", 10);
  if (blocked) return blocked;

  try {
    await requireOwner();

    const hasApiKey = Boolean(process.env.FAZER_API_KEY?.trim());

    if (!hasApiKey) {
      return NextResponse.json(
        { ok: false, connected: false, error: "FAZERCARDS_NOT_CONFIGURED" },
        { status: 503 },
      );
    }

    const [me, balance] = await Promise.all([
      getFazerCardsMe(),
      getFazerCardsBalance(),
    ]);

    return NextResponse.json({ ok: true, connected: true, me, balance });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "UNAUTHORIZED") {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }
    if (message === "FORBIDDEN") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }
    // Upstream/provider messages stay in the server log only.
    console.error("FazerCards test failed:", error);
    return NextResponse.json(
      { ok: false, connected: false, error: "FAZERCARDS_CONNECTION_FAILED" },
      { status: 502 },
    );
  }
}
