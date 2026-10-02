/**
 * GameVortex AI Trading — provider-neutral live-order reconciliation.
 *
 * This module never calls an exchange and never mutates the database. It
 * compares the immutable local order intent with a normalized provider
 * observation. Any identity or semantic drift is returned explicitly so the
 * persistence layer can fail closed instead of overwriting local state.
 */

export type LiveOrderIntent = {
  clientOrderId: string;
  providerOrderId?: string | null;
  symbol: string;
  side: "BUY";
};

export type LiveProviderOrderStatus =
  | "NEW"
  | "PENDING_NEW"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "EXPIRED"
  | "PENDING_CANCEL"
  | "UNKNOWN";

export type LiveProviderOrderObservation = {
  clientOrderId: string;
  providerOrderId?: string | null;
  symbol: string;
  side: "BUY";
  status: LiveProviderOrderStatus;
  executedQty: string | number;
  cumulativeQuoteQty: string | number;
  averageFillPrice?: string | number | null;
  updatedAt: Date | string | number;
};

export type LiveReconciliation =
  | {
      status: "MATCHED";
      nextState:
        | "SUBMITTED"
        | "PARTIALLY_FILLED"
        | "FILLED"
        | "CANCELED"
        | "REJECTED"
        | "EXPIRED";
      clientOrderId: string;
      providerOrderId: string | null;
      providerStatus: LiveProviderOrderStatus;
    }
  | {
      status: "MISMATCHED";
      clientOrderId: string;
      providerOrderId: string | null;
      providerStatus: LiveProviderOrderStatus;
      reasons: string[];
    };

function validIdentifier(value: string | null | undefined, max = 200): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

function parseNonNegativeDecimal(value: string | number): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function parseDate(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function mapProviderOrderStatus(
  status: LiveProviderOrderStatus,
): LiveReconciliation["status"] extends never ? never : Exclude<LiveReconciliation, { status: "MISMATCHED" }>["nextState"] {
  switch (status) {
    case "NEW":
    case "PENDING_NEW":
    case "PENDING_CANCEL":
      return "SUBMITTED";
    case "PARTIALLY_FILLED":
      return "PARTIALLY_FILLED";
    case "FILLED":
      return "FILLED";
    case "CANCELED":
      return "CANCELED";
    case "REJECTED":
      return "REJECTED";
    case "EXPIRED":
      return "EXPIRED";
    case "UNKNOWN":
      throw new Error("UNKNOWN_PROVIDER_ORDER_STATUS");
  }
}

export function reconcileLiveOrderObservation(
  intent: LiveOrderIntent,
  observation: LiveProviderOrderObservation,
): LiveReconciliation {
  const reasons: string[] = [];

  if (!validIdentifier(intent.clientOrderId, 128)) reasons.push("INVALID_LOCAL_CLIENT_ORDER_ID");
  if (!validIdentifier(observation.clientOrderId, 128)) reasons.push("INVALID_PROVIDER_CLIENT_ORDER_ID");
  if (!validIdentifier(observation.symbol, 32)) reasons.push("INVALID_PROVIDER_SYMBOL");
  if (intent.clientOrderId !== observation.clientOrderId) reasons.push("CLIENT_ORDER_ID_MISMATCH");
  if (intent.symbol.trim().toUpperCase() !== observation.symbol.trim().toUpperCase()) {
    reasons.push("SYMBOL_MISMATCH");
  }
  if (intent.side !== observation.side) reasons.push("SIDE_MISMATCH");

  if (
    intent.providerOrderId &&
    observation.providerOrderId &&
    intent.providerOrderId !== observation.providerOrderId
  ) {
    reasons.push("PROVIDER_ORDER_ID_MISMATCH");
  }

  if (!validIdentifier(observation.providerOrderId, 128)) {
    reasons.push("PROVIDER_ORDER_ID_MISSING");
  }

  if (parseNonNegativeDecimal(observation.executedQty) === null) {
    reasons.push("INVALID_EXECUTED_QTY");
  }

  if (parseNonNegativeDecimal(observation.cumulativeQuoteQty) === null) {
    reasons.push("INVALID_CUMULATIVE_QUOTE_QTY");
  }

  if (
    observation.averageFillPrice !== undefined &&
    observation.averageFillPrice !== null &&
    parseNonNegativeDecimal(observation.averageFillPrice) === null
  ) {
    reasons.push("INVALID_AVERAGE_FILL_PRICE");
  }

  if (!parseDate(observation.updatedAt)) reasons.push("INVALID_PROVIDER_UPDATE_TIME");

  if (reasons.length > 0) {
    return {
      status: "MISMATCHED",
      clientOrderId: observation.clientOrderId,
      providerOrderId: observation.providerOrderId ?? null,
      providerStatus: observation.status,
      reasons: [...new Set(reasons)],
    };
  }

  return {
    status: "MATCHED",
    nextState: mapProviderOrderStatus(observation.status),
    clientOrderId: observation.clientOrderId,
    providerOrderId: observation.providerOrderId ?? null,
    providerStatus: observation.status,
  };
}
