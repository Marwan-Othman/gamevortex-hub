import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import { createApprovalToken, verifyApprovalToken, type ApprovalToken } from "./approval";

const MIN_APPROVAL_AMOUNT_USD = new Prisma.Decimal(1);

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
};

type ApprovalRow = OwnerApproval & {
  tokenHash: string;
};

export type OwnerApprovalToken = ApprovalToken;

export type CreateOwnerApprovalInput = {
  ownerId: string;
  opportunityId: string;
  amountUsd: string | number;
  shariahStatus: "APPROVED";
  strategyVersion?: string;
  riskSnapshot?: Prisma.JsonObject;
  ttlSeconds: number;
};

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

export async function createOwnerApproval(input: CreateOwnerApprovalInput): Promise<{
  approval: OwnerApproval;
  token: OwnerApprovalToken;
}> {
  if (!input.ownerId || !input.opportunityId.trim()) {
    throw new Error("INVALID_APPROVAL_INPUT");
  }

  if (input.shariahStatus !== "APPROVED") {
    throw new Error("SHARIAH_APPROVAL_REQUIRED");
  }

  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 30 || input.ttlSeconds > 15 * 60) {
    throw new Error("INVALID_APPROVAL_TTL");
  }

  const amountUsd = normalizeAmount(input.amountUsd);
  const token = createApprovalToken(input.opportunityId, input.ttlSeconds);
  const id = randomUUID();
  const riskSnapshot = input.riskSnapshot === undefined ? null : JSON.stringify(input.riskSnapshot);

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ApprovalRow[]>(Prisma.sql`
      INSERT INTO "TradingApproval" (
        "id",
        "opportunityId",
        "ownerId",
        "amountUsd",
        "issuedAt",
        "expiresAt",
        "status",
        "strategyVersion",
        "shariahStatus",
        "riskSnapshot",
        "tokenHash"
      )
      VALUES (
        ${id},
        ${token.opportunityId},
        ${input.ownerId},
        ${amountUsd.toString()}::numeric,
        ${new Date(token.issuedAt)},
        ${new Date(token.expiresAt)},
        'PENDING',
        ${input.strategyVersion ?? null},
        'APPROVED',
        ${riskSnapshot}::jsonb,
        ${token.tokenHash}
      )
      RETURNING
        "id",
        "opportunityId",
        "ownerId",
        "amountUsd",
        "issuedAt",
        "expiresAt",
        "consumedAt",
        "status",
        "strategyVersion",
        "shariahStatus",
        "riskSnapshot",
        "tokenHash"
    `;

    const approval = rows[0];
    if (!approval) {
      throw new Error("APPROVAL_CREATION_FAILED");
    }

    await tx.auditLog.create({
      data: {
        actorUserId: input.ownerId,
        action: "TRADING_APPROVAL_ISSUED",
        entityType: "TradingApproval",
        entityId: approval.id,
        metadata: {
          opportunityId: approval.opportunityId,
          amountUsd: approval.amountUsd.toString(),
          expiresAt: approval.expiresAt.toISOString(),
          strategyVersion: approval.strategyVersion,
          shariahStatus: approval.shariahStatus,
        },
      },
    });

    return { approval, token: { ...token } };
  });
}

export async function consumeOwnerApproval(input: {
  ownerId: string;
  approvalId: string;
  opportunityId: string;
  token: string;
}): Promise<OwnerApproval> {
  if (!input.ownerId || !input.approvalId || !input.opportunityId.trim() || !input.token) {
    throw new Error("INVALID_APPROVAL_INPUT");
  }

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ApprovalRow[]>(Prisma.sql`
      SELECT
        "id",
        "opportunityId",
        "ownerId",
        "amountUsd",
        "issuedAt",
        "expiresAt",
        "consumedAt",
        "status",
        "strategyVersion",
        "shariahStatus",
        "riskSnapshot",
        "tokenHash"
      FROM "TradingApproval"
      WHERE "id" = ${input.approvalId}
        AND "ownerId" = ${input.ownerId}
        AND "opportunityId" = ${input.opportunityId.trim()}
      FOR UPDATE
    `);

    const approval = rows[0];
    if (!approval) throw new Error("APPROVAL_NOT_FOUND");

    if (approval.consumedAt || approval.status === "CONSUMED") {
      throw new Error("APPROVAL_ALREADY_CONSUMED");
    }

    if (approval.status === "REVOKED") {
      throw new Error("APPROVAL_REVOKED");
    }

    if (approval.status === "EXPIRED") {
      throw new Error("APPROVAL_EXPIRED");
    }

    if (approval.status !== "PENDING") {
      throw new Error("APPROVAL_NOT_CONSUMABLE");
    }

    const verification = verifyApprovalToken({
      opportunityId: approval.opportunityId,
      token: input.token,
      expectedTokenHash: approval.tokenHash,
      expiresAt: approval.expiresAt.toISOString(),
    });

    if (!verification.valid) {
      if (verification.reason === "EXPIRED") {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "TradingApproval"
          SET "status" = 'EXPIRED'
          WHERE "id" = ${approval.id}
            AND "status" = 'PENDING'
            AND "consumedAt" IS NULL
        `);

        await tx.auditLog.create({
          data: {
            actorUserId: input.ownerId,
            action: "TRADING_APPROVAL_EXPIRED",
            entityType: "TradingApproval",
            entityId: approval.id,
            metadata: { opportunityId: approval.opportunityId },
          },
        });

        throw new Error("APPROVAL_EXPIRED");
      }

      throw new Error("INVALID_APPROVAL_TOKEN");
    }

    const consumedAt = new Date();
    const updated = await tx.$queryRaw<ApprovalRow[]>(Prisma.sql`
      UPDATE "TradingApproval"
      SET
        "status" = 'CONSUMED',
        "consumedAt" = ${consumedAt}
      WHERE "id" = ${approval.id}
        AND "ownerId" = ${input.ownerId}
        AND "status" = 'PENDING'
        AND "consumedAt" IS NULL
        AND "expiresAt" > CURRENT_TIMESTAMP
      RETURNING
        "id",
        "opportunityId",
        "ownerId",
        "amountUsd",
        "issuedAt",
        "expiresAt",
        "consumedAt",
        "status",
        "strategyVersion",
        "shariahStatus",
        "riskSnapshot",
        "tokenHash"
    `;

    const result = updated[0];
    if (!result) throw new Error("APPROVAL_NOT_CONSUMABLE");

    await tx.auditLog.create({
      data: {
        actorUserId: input.ownerId,
        action: "TRADING_APPROVAL_CONSUMED",
        entityType: "TradingApproval",
        entityId: result.id,
        metadata: {
          opportunityId: result.opportunityId,
          amountUsd: result.amountUsd.toString(),
          consumedAt: result.consumedAt?.toISOString() ?? null,
        },
      },
    });

    return result;
  });
}

export async function revokeOwnerApproval(input: {
  ownerId: string;
  approvalId: string;
}): Promise<void> {
  if (!input.ownerId || !input.approvalId) {
    throw new Error("INVALID_APPROVAL_INPUT");
  }

  return db.$transaction(async (tx) => {
    const result = await tx.$executeRaw(Prisma.sql`
      UPDATE "TradingApproval"
      SET "status" = 'REVOKED'
      WHERE "id" = ${input.approvalId}
        AND "ownerId" = ${input.ownerId}
        AND "status" = 'PENDING'
        AND "consumedAt" IS NULL
        AND "expiresAt" > CURRENT_TIMESTAMP
    `);

    if (result !== 1) throw new Error("APPROVAL_NOT_REVOKABLE");

    await tx.auditLog.create({
      data: {
        actorUserId: input.ownerId,
        action: "TRADING_APPROVAL_REVOKED",
        entityType: "TradingApproval",
        entityId: input.approvalId,
      },
    });
  });
}
