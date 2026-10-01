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

  const rows = await db.$queryRaw<ApprovalRow[]>(Prisma.sql`
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
      ${token.opportunityId},
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
  `);

  const approval = rows[0];
  if (!approval) throw new Error("APPROVAL_PERSISTENCE_FAILED");

  return { approval, token };
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
    `);

    const approval = rows[0];
    if (!approval) throw new Error("APPROVAL_NOT_FOUND");

    if (approval.consumedAt || approval.status === "CONSUMED") {
      throw new Error("APPROVAL_ALREADY_CONSUMED");
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
    `);

    const result = updated[0];
    if (!result) throw new Error("APPROVAL_NOT_CONSUMABLE");

    return result;
  });
}

export async function revokeOwnerApproval(input: {
  ownerId: string;
  approvalId: string;
}): Promise<void> {
  const result = await db.$executeRaw(Prisma.sql`
    UPDATE "TradingApproval"
    SET "status" = 'REVOKED'
    WHERE "id" = ${input.approvalId}
      AND "ownerId" = ${input.ownerId}
      AND "status" = 'PENDING'
      AND "consumedAt" IS NULL
  `);

  if (result !== 1) throw new Error("APPROVAL_NOT_REVOKABLE");
}
