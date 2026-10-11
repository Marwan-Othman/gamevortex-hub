import { startAiUsage, finishAiUsage } from "@/lib/gamevortex-ai/usage-ledger";
import { logSystemError } from "@/lib/observability";

type Operation = "IMAGE" | "VIDEO";

/**
 * Best-effort ledger rows for image/video so the admin monitor and usage
 * endpoint cover every AI feature. Never throws: bookkeeping must not change
 * the outcome of a request.
 */
export async function recordMediaUsage(input: {
  userId: string;
  operation: Operation;
  idempotencyKey: string;
  requestId: string;
  status: "COMPLETED" | "FAILED";
  gvcUsed: number;
  gvcRefunded?: number;
  errorCode?: string | null;
}) {
  try {
    const { usage } = await startAiUsage({
      userId: input.userId,
      provider: "gemini",
      operation: input.operation,
      idempotencyKey: `${input.userId}:${input.operation.toLowerCase()}:${input.idempotencyKey}`,
      gvcReserved: input.gvcUsed + (input.gvcRefunded ?? 0),
      requestId: input.requestId,
    });
    await finishAiUsage(usage.id, input.userId, {
      status: input.status,
      gvcUsed: input.status === "COMPLETED" ? input.gvcUsed : 0,
      gvcRefunded: input.gvcRefunded ?? 0,
      errorCode: input.errorCode ?? null,
    });
  } catch (error) {
    await logSystemError("ai:usage-ledger-failed", error, { userId: input.userId, metadata: { operation: input.operation } }).catch(() => undefined);
  }
}
