/**
 * GameVortex AI Trading — sellable base quantity after a Spot BUY.
 *
 * Binance can charge the BUY commission in the BASE asset, so the free balance
 * is smaller than `executedQty`. Submitting a protective SELL for the full
 * `executedQty` would then be rejected. This computes the quantity that can
 * actually be sold: executedQty - base-asset commissions, floored to the
 * symbol's step size. Third-asset commissions (for example BNB) do not reduce
 * the base balance. Uses exact BigInt decimal math; never rounds up.
 */

const SCALE_DIGITS = 18;
const SCALE = 10n ** BigInt(SCALE_DIGITS);

export type SellableFee = { commission: string; commissionAsset: string };

function parseDecimal(value: string, code: string): bigint {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error(code);
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > SCALE_DIGITS && /[1-9]/.test(fraction.slice(SCALE_DIGITS))) throw new Error(code);
  const padded = (fraction + "0".repeat(SCALE_DIGITS)).slice(0, SCALE_DIGITS);
  return BigInt(whole) * SCALE + BigInt(padded);
}

function formatDecimal(value: bigint): string {
  const whole = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(SCALE_DIGITS, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function computeSellableQuantity(input: {
  executedQty: string;
  baseAsset: string;
  fees: readonly SellableFee[];
  stepSize?: string | null;
}): string {
  const baseAsset = input.baseAsset.trim().toUpperCase();
  if (!baseAsset) throw new Error("INVALID_BASE_ASSET");

  let quantity = parseDecimal(input.executedQty, "INVALID_EXECUTED_QTY");
  for (const fee of input.fees) {
    if (fee.commissionAsset.trim().toUpperCase() !== baseAsset) continue;
    quantity -= parseDecimal(fee.commission, "INVALID_ENTRY_COMMISSION");
  }
  if (quantity <= 0n) throw new Error("LIVE_SELLABLE_QUANTITY_NOT_POSITIVE");

  if (input.stepSize !== undefined && input.stepSize !== null && input.stepSize !== "") {
    const step = parseDecimal(input.stepSize, "INVALID_STEP_SIZE");
    if (step > 0n) quantity -= quantity % step;
    if (quantity <= 0n) throw new Error("LIVE_SELLABLE_QUANTITY_NOT_POSITIVE");
  }

  return formatDecimal(quantity);
}
