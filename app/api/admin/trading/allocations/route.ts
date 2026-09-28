import { NextRequest, NextResponse } from "next/server";
import { guardMutation, guardRead } from "@/lib/api";
import { requireTradingOwner, tradingErrorStatus, tradingForbidden } from "@/lib/trading/access";
import { createAllocation, getTradingSummary } from "@/lib/trading/allocation";
import { validateIdempotencyKey } from "@/lib/trading/money";
import { logSystemError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:trading:allocations", 60);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;
    const summary = await getTradingSummary(owner.id);
    return NextResponse.json({ ok: true, allocations: summary.allocations });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return tradingForbidden();
    await logSystemError("admin:trading:allocations:get", error, { userId: ownerId });
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:trading:allocations", 10);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new Error("INVALID_JSON");
    }
    const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};

    const key = validateIdempotencyKey(request.headers.get("idempotency-key") ?? raw.idempotencyKey);

    // amountUsd is validated (type, integer, >= $1, <= max) inside createAllocation.
    const { allocation, replayed } = await createAllocation({
      ownerId: owner.id,
      amountUsd: raw.amountUsd,
      idempotencyKey: key,
    });

    return NextResponse.json(
      { ok: true, replayed, allocation: { id: allocation.id, amountUsd: allocation.amountUsd, points: allocation.points, status: allocation.status } },
      { status: replayed ? 200 : 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
    if (message === "FORBIDDEN") return tradingForbidden();
    const status = tradingErrorStatus(message);
    if (status) return NextResponse.json({ error: message }, { status });
    await logSystemError("admin:trading:allocations:post", error, { userId: ownerId });
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
