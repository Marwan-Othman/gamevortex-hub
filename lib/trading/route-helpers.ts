import { NextRequest, NextResponse } from "next/server";
import { logSystemError } from "../observability";
import { TradingInputError } from "./errors";
import { tradingErrorStatus, tradingForbidden } from "./access";

/** Parse a JSON object body; anything else is INVALID_JSON. */
export async function readJsonObject(request: NextRequest): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new Error("INVALID_JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_JSON");
  return body as Record<string, unknown>;
}

/** One place that maps trading errors to responses without leaking internals. */
export async function tradingRouteError(error: unknown, scope: string, userId?: string) {
  const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
  if (message === "FORBIDDEN") return tradingForbidden();

  const status = tradingErrorStatus(message);
  if (status) {
    const field = error instanceof TradingInputError ? error.field : undefined;
    return NextResponse.json(field ? { error: message, field } : { error: message }, { status });
  }

  await logSystemError(scope, error, { userId });
  return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
}
