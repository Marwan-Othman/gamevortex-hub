export type AiCostKey = "CHAT_COST" | "ADVANCED_CHAT_COST" | "IMAGE_COST" | "IMAGE_EDIT_COST" | "HIGH_QUALITY_IMAGE_COST" | "VIDEO_COST" | "VIDEO_EDIT_COST";

const defaults: Record<AiCostKey, number> = {
  CHAT_COST: 1,
  ADVANCED_CHAT_COST: 3,
  IMAGE_COST: 10,
  IMAGE_EDIT_COST: 15,
  HIGH_QUALITY_IMAGE_COST: 20,
  VIDEO_COST: 50,
  VIDEO_EDIT_COST: 100,
};

function configured(key: AiCostKey): number {
  const raw = process.env[key];
  const value = raw === undefined || raw.trim() === '' ? defaults[key] : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000) throw new Error(`INVALID_AI_COST_${key}`);
  return value;
}

export function getAiCost(key: AiCostKey): number {
  return configured(key);
}
