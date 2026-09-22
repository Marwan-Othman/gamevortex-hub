import { NextRequest, NextResponse } from "next/server";
import { getFazerCardsBalance, getFazerCardsMe } from "@/lib/integrations/fazercards";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();

    if (user.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { ok: false, error: "Forbidden" },
        { status: 403 },
      );
    }

    const hasApiKey = Boolean(process.env.FAZER_API_KEY?.trim());

    if (!hasApiKey) {
      return NextResponse.json(
        {
          ok: false,
          connected: false,
          error: "FAZER_API_KEY is not configured",
        },
        { status: 500 },
      );
    }

    const [me, balance] = await Promise.all([
      getFazerCardsMe(),
      getFazerCardsBalance(),
    ]);

    return NextResponse.json({
      ok: true,
      connected: true,
      me,
      balance,
    });
  } catch (error) {
    console.error("FazerCards test failed:", error);

    return NextResponse.json(
      {
        ok: false,
        connected: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown FazerCards connection error",
      },
      { status: 500 },
    );
  }
}
