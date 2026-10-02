import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";

const MIN_APPROVAL_AMOUNT_USD = new Prisma.Decimal(1);

export type OwnerExecutionSnapshot = {
  symbol: string;
  price: number;
  previousPrice: number;
  fastAverage: number;
  slowAverage: number;
  volume: number;
  averageVolume: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  shariah: Prisma.JsonObject;
};

export type OwnerApproval = {
  id: string;
  opportunityId: string;
  ownerId: string;
  amountUsd: Prisma.Decimal;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  status: string;
  strategyVersion: string | null;
  shariahStatus: string;
  riskSnapshot: Prisma.JsonValue | null;
  executionSnapshot: Prisma.JsonValue | null;
};

export type OwnerApprovalToken = { token: string };

export type CreateOwnerApprovalInput = {
  ownerId: string;
  opportunityId: string;
  amountUsd: string | number;
  shariahStatus: "APPROVED";
  strategyVersion?: string;
  riskSnapshot?: Prisma.JsonObject;
  executionSnapshot: OwnerExecutionSnapshot;
  ttlSeconds: number;
};

function hashToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function normalizeAmount(value: string | number) {
  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(value);
  } catch {
    throw new Error("INVALID_APPROVAL_AMOUNT");
  }

  if (!amount.isFinite() || amount.lessThan(MIN_APPROVAL_AMOUNT_USD)) {
    throw new Error("INVALID_APPROVAL_AMOUNT");
  }

  return amount.toDecimalPlaces(2);
}

function validateSnapshot(snapshot: OwnerExecutionSnapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("INVALID_EXECUTION_SNAPSHOT");
  }

  if (!snapshot.symbol?.trim()) {
    throw new Error("INVALID_EXECUTION_SNAPSHOT");
  }

  const values = [
    snapshot.price,
    snapshot.previousPrice,
    snapshot.fastAverage,
    snapshot.slowAverage,
    snapshot.volume,
    snapshot.averageVolume,
    snapshot.stopLossPercent,
    snapshot.takeProfitPercent,
  ];

  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("INVALID_EXECUTION_SNAPSHOT");
  }

  if (!snapshot.shariah || typeof snapshot.shariah !== "object" || Array.isArray(snapshot.shariah)) {
    throw new Error("INVALID_EXECUTION_SNAPSHOT");
  }
}

export async function createOwnerApproval(
  input: CreateOwnerApprovalInput,
): Promise<{ approval: OwnerApproval; token: OwnerApprovalToken }> {
  if (!input.ownerId || !input.opportunityId) {
    throw new Error("INVALID_APPROVAL_INPUT");
  }

  if (input.shariahStatus !== "APPROVED") {
    throw new Error("SHARIAH_APPROVAL_REQUIRED");
  }

  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 30 || input.ttlSeconds > 15 * 60) {
    throw new Error("INVALID_APPROVAL_TTL");
  }

  validateSnapshot(input.executionSnapshot);

  const amountUsd = normalizeAmount(input.amountUsd);
  const tokenValue = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(tokenValue);
  const id = randomBytes(18).toString("base64url");
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + input.ttlSeconds * 1000);
  const riskSnapshot = input.riskSnapshot === undefined ? null : JSON.stringify(input.riskSnapshot);
  const executionSnapshot = JSON.stringify(input.executionSnapshot);

  const rows = await db.$queryRaw<OwnerApproval[]>(Prisma.sql`
    INSERT INTO "TradingApproval" (
      "id", "opportunityId", "ownerId", "amountUsd", "issuedAt", "expiresAt", "status",
      "strategyVersion", "shariahStatus", "riskSnapshot", "executionSnapshot", "tokenHash"
    ) VALUES (
      ${id}, ${input.opportunityId}, ${input.ownerId}, ${amountUsd.toString()}::numeric, ${issuedAt}, ${expiresAt},
      'PENDING', ${input.strategyVersion ?? null}, 'APPROVED', ${riskSnapshot}::jsonb, ${executionSnapshot}::jsonb, ${tokenHash}
    )
    RETURNING "id", "opportunityId", "ownerId", "amountUsd", "issuedAt", "expiresAt", "consumedAt", "status",
      "strategyVersion", "shariahStatus", "riskSnapshot", "executionSnapshot"
  `;

  const approval = rows[0];
  if (!approval) {
    throw new Error("APPROVAL_CREATION_FAILED");
  }

  return { approval, token: { token: tokenValue } };
}

export function hashOwnerApprovalToken(token: string) {
  return hashToken(token);
}
