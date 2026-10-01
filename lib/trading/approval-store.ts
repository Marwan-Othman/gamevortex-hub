import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "../prisma";
import {
  createApprovalToken,
  verifyApprovalToken,
  type ApprovalToken,
} from "./approval";

const MIN_APPROVAL_AMOUNT_USD = new Prisma.Decimal(1);

type ApprovalRow = {
  id: string;
  opportunityId: string;
  ownerId: string;
  amountUsd: Prisma.Decimal;
  tokenHash: string;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  status: string;
  strategyVersion: string | null;
  shariahStatus: string;
  riskSnapshot: Prisma.JsonValue | null;
};

export type PersistedOwnerApproval = ApprovalRow;

export async function createOwnerApproval(input: {
  ownerId: string;
  opportunityId: string;
  amountUsd: Prisma.Decimal | number | string;
  shariahStatus: "APPROVED";
  strategyVersion?: string;
  riskSnapshot?: Prisma.JsonValue;
  ttlSeconds?: number;
}): Promise<{ approval: PersistedOwnerApproval; token: ApprovalToken }> {
  const amountUsd = new Prisma.Decimal(input.amountUsd);
  if (!amountUsd.isFinite() || amountUsd.lt(MIN_APPROVAL_AMOUNT_USD)) {
    throw new Error("INVALID_APPROVAL_AMOUNT");
  }

  const token = createApprovalToken(input.opportunityId, input.ttlSeconds);
  const id = randomUUID();

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ApprovalRow[]>(Prisma.sql`
      INSERT INTO "TradingApproval" (
        "id",
        "opportunityId",
        "ownerId",
        "amountUsd",
        "tokenHash",
        "issuedAt",
        "expiresAt",
        "status",
        "strategyVersion",
        "shariahStatus",
        "riskSnapshot"
      ) VALUES (
        ${id},
        ${input.opportunityId},
        ${input.ownerId},
        ${amountUsd},
        ${token.tokenHash},
        ${new Date(token.issuedAt)},
        ${new Date(token.expiresAt)},
        'PENDING',
        ${input.strategyVersion ?? null},
        ${input.shariahStatus},
        ${input.riskSnapshot ?? Prisma.JsonNull}
      )
      RETURNING
        "id",
        "opportunityId",
        "ownerId",
        "amountUsd",
        "tokenHash",
        "issuedAt",
        "expiresAt",
        "consumedAt",
        "status",
        "strategyVersion",
        "shariahStatus",
        "riskSnapshot"
    `;

    const approval = rows[0];
    if (!approval) throw new Error("APPROVAL_PERSISTENCE_FAILED");

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

    return { approval, token };
  });
}

export async function consumeOwnerApproval(input: {
  ownerId: string;
  approvalId: string;
  opportunityId: string;
  token: string;
}): Promise<PersistedOwnerApproval> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<ApprovalRow[]>(Prisma.sql`
      SELECT
        "id",
        "opportunityId",
        "ownerId",
        "amountUsd",
        "tokenHash",
        "issuedAt",
        "expiresAt",
        "consumedAt",
        "status",
        "strategyVersion",
        "shariahStatus",
        "riskSnapshot"
      FROM "TradingApproval"
      WHERE "id" = ${input.approvalId}
        AND "ownerId" = ${input.ownerId}
        AND "opportunityId" = ${input.opportunityId}
      FOR UPDATE
    `;

    const approval = rows[0];
    if (!approval) throw new Error("APPROVAL_NOT_FOUND");

    if (approval.consumedAt || approval.status === "CONSUMED") {
      throw new Error("APPROVAL_ALREADY_CONSUMED");
    }

    if (approval.status === "REVOKED") {
      throw new Error("APPROVAL_REVOKED");
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
        "tokenHash",
        "issuedAt",
        "expiresAt",
        "consumedAt",
        "status",
        "strategyVersion",
        "shariahStatus",
        "riskSnapshot"
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
  return db.$transaction(async (tx) => {
    const result = await tx.$executeRaw(Prisma.sql`
      UPDATE "TradingApproval"
      SET "status" = 'REVOKED'
      WHERE "id" = ${input.approvalId}
        AND "ownerId" = ${input.ownerId}
        AND "status" = 'PENDING'
        AND "consumedAt" IS NULL
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
