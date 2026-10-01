import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import { verifyApprovalToken } from "./approval";
import type { OwnerApproval } from "./approval-store";

type ApprovalRow = OwnerApproval & {
  tokenHash: string;
};

function assertOwner(ownerId: string) {
  if (!ownerId.trim()) throw new Error("INVALID_APPROVAL_OWNER");
}

export async function consumeOwnerApproval(input: {
  ownerId: string;
  approvalId: string;
  opportunityId: string;
  token: string;
}): Promise<OwnerApproval> {
  assertOwner(input.ownerId);

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
        AND "opportunityId" = ${input.opportunityId.trim()}
      FOR UPDATE
    `);

    const approval = rows[0];
    if (!approval) throw new Error("APPROVAL_NOT_FOUND");
    if (approval.consumedAt || approval.status === "CONSUMED") {
      throw new Error("APPROVAL_ALREADY_CONSUMED");
    }
    if (approval.status === "REVOKED") throw new Error("APPROVAL_REVOKED");
    if (approval.status === "EXPIRED") throw new Error("APPROVAL_EXPIRED");
    if (approval.status !== "PENDING") throw new Error("APPROVAL_NOT_CONSUMABLE");

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

        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "AuditLog" (
            "id", "actorUserId", "action", "entityType", "entityId", "metadata"
          ) VALUES (
            ${randomUUID()},
            ${input.ownerId},
            'TRADING_APPROVAL_EXPIRED',
            'TradingApproval',
            ${approval.id},
            ${JSON.stringify({ opportunityId: approval.opportunityId })}::jsonb
          )
        `);

        throw new Error("APPROVAL_EXPIRED");
      }

      throw new Error("INVALID_APPROVAL_TOKEN");
    }

    const consumedAt = new Date();
    const updated = await tx.$queryRaw<ApprovalRow[]>(Prisma.sql`
      UPDATE "TradingApproval"
      SET "status" = 'CONSUMED', "consumedAt" = ${consumedAt}
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
    `);

    const result = updated[0];
    if (!result) throw new Error("APPROVAL_NOT_CONSUMABLE");

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "AuditLog" (
        "id", "actorUserId", "action", "entityType", "entityId", "metadata"
      ) VALUES (
        ${randomUUID()},
        ${input.ownerId},
        'TRADING_APPROVAL_CONSUMED',
        'TradingApproval',
        ${result.id},
        ${JSON.stringify({
          opportunityId: result.opportunityId,
          amountUsd: result.amountUsd.toString(),
          consumedAt: result.consumedAt?.toISOString() ?? null,
        })}::jsonb
      )
    `);

    return result;
  });
}

export async function revokeOwnerApproval(input: {
  ownerId: string;
  approvalId: string;
}): Promise<void> {
  assertOwner(input.ownerId);

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

    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "AuditLog" (
        "id", "actorUserId", "action", "entityType", "entityId"
      ) VALUES (
        ${randomUUID()},
        ${input.ownerId},
        'TRADING_APPROVAL_REVOKED',
        'TradingApproval',
        ${input.approvalId}
      )
    `);
  });
}
