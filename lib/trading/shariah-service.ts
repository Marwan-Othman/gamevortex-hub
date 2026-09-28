import { Prisma } from "@prisma/client";
import { db } from "../prisma";
import {
  DEFAULT_SHARIAH_POLICY,
  applyPolicyReviewGate,
  evaluateShariah,
  type ShariahAssetInput,
} from "./shariah";

/**
 * Evaluate an asset, then in ONE transaction: upsert the asset profile and
 * append an immutable audit row. The result is what the Trading Executor must
 * trust: it already includes the policy review gate, so an unreviewed or
 * inactive policy can never yield APPROVED.
 */
export async function checkAndRecordShariah(input: { actorUserId: string; asset: ShariahAssetInput }) {
  const policy = DEFAULT_SHARIAH_POLICY;

  const policyRow = await db.shariahPolicy.findUnique({ where: { version: policy.version } });
  if (!policyRow) throw new Error("SHARIAH_POLICY_NOT_FOUND");

  const raw = evaluateShariah(input.asset, policy);
  const decision = applyPolicyReviewGate(raw, {
    status: policyRow.status,
    reviewedAt: policyRow.reviewedAt,
  });

  const reason = decision.reasons.length ? decision.reasons.join(", ") : "ALL_CHECKS_PASSED";
  const auditInput = JSON.parse(JSON.stringify(input.asset)) as Prisma.InputJsonValue;

  const { profile, auditLog } = await db.$transaction(async (tx) => {
    const profileData = {
      assetType: input.asset.assetType,
      issuer: input.asset.issuer ?? null,
      businessActivity: input.asset.businessActivity ?? null,
      status: decision.status,
      reason,
      source: input.asset.source ?? null,
      lastCheckedAt: new Date(decision.checkedAt),
      ruleVersion: decision.policyVersion,
      financialRatios: input.asset.financialRatios
        ? (JSON.parse(JSON.stringify(input.asset.financialRatios)) as Prisma.InputJsonValue)
        : Prisma.DbNull,
      tradingMethod: input.asset.tradingMethod,
      ownershipSettlementVerified: input.asset.ownershipSettlementVerified,
    };

    const profile = await tx.assetShariahProfile.upsert({
      where: { symbol_policyId: { symbol: decision.symbol, policyId: policyRow.id } },
      create: { symbol: decision.symbol, policyId: policyRow.id, ...profileData },
      update: profileData,
    });

    const auditLog = await tx.shariahAuditLog.create({
      data: {
        actorUserId: input.actorUserId,
        policyId: policyRow.id,
        policyVersion: decision.policyVersion,
        symbol: decision.symbol,
        status: decision.status,
        reasons: decision.reasons,
        input: auditInput,
        source: input.asset.source ?? null,
      },
    });

    return { profile, auditLog };
  });

  return { decision, profileId: profile.id, auditId: auditLog.id };
}
