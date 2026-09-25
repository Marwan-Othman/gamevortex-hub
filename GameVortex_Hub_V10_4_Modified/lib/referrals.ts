import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./prisma";

export const REFERRAL_REFERRER_POINTS = Number(process.env.REFERRAL_REFERRER_POINTS ?? 200);
export const REFERRAL_REFERRED_POINTS = Number(process.env.REFERRAL_REFERRED_POINTS ?? 100);

function randomCodeSuffix(length = 5) {
  return randomBytes(length).toString("hex").slice(0, length).toUpperCase();
}

function codeFromUsername(username: string | null | undefined) {
  const base = (username || "GV").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 10) || "GV";
  return `${base}-${randomCodeSuffix()}`;
}

/**
 * Generates a unique referral code for a user, retrying on the rare collision.
 * Safe to call outside a transaction: uniqueness is still enforced by the
 * `referralCode` unique constraint, so a collision only costs a retry.
 */
export async function generateUniqueReferralCode(username: string | null | undefined) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = codeFromUsername(username);
    const existing = await db.user.findUnique({ where: { referralCode: code }, select: { id: true } });
    if (!existing) return code;
  }
  return `GV-${randomBytes(8).toString("hex").toUpperCase()}`;
}

/** Backfills a referral code for users created before this feature existed. */
export async function ensureReferralCode(userId: string, username: string | null | undefined, existingCode: string | null | undefined) {
  if (existingCode) return existingCode;
  const code = await generateUniqueReferralCode(username);
  try {
    await db.user.update({ where: { id: userId }, data: { referralCode: code } });
    return code;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const refreshed = await db.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
      if (refreshed?.referralCode) return refreshed.referralCode;
    }
    throw error;
  }
}

/**
 * Links a newly-registered user to whoever referred them. Silent no-op on any
 * invalid/self/duplicate code so registration never fails because of it.
 */
export async function linkReferral(referredId: string, rawCode: string | undefined | null) {
  const code = rawCode?.trim().toUpperCase();
  if (!code) return null;
  const referrer = await db.user.findUnique({ where: { referralCode: code }, select: { id: true } });
  if (!referrer || referrer.id === referredId) return null;
  try {
    return await db.referral.create({
      data: { referrerId: referrer.id, referredId, status: "PENDING" },
    });
  } catch {
    return null;
  }
}

/**
 * Qualifies + rewards a referral the first time the referred user completes
 * an order. Idempotent: only ever transitions a PENDING referral once, guarded
 * by the transaction's row lock via updateMany's status filter.
 */
export async function qualifyReferralOnFirstOrder(tx: Prisma.TransactionClient, referredUserId: string) {
  const referral = await tx.referral.findUnique({ where: { referredId: referredUserId } });
  if (!referral || referral.status !== "PENDING") return null;

  // The order that triggered this call is already COMPLETED when this runs,
  // so exactly one completed order total means this is the qualifying first order.
  const completedOrders = await tx.order.count({ where: { userId: referredUserId, status: "COMPLETED" } });
  if (completedOrders !== 1) return null;

  const updated = await tx.referral.updateMany({
    where: { id: referral.id, status: "PENDING" },
    data: { status: "REWARDED", qualifiedAt: new Date(), rewardedAt: new Date(), rewardPoints: REFERRAL_REFERRER_POINTS },
  });
  if (updated.count !== 1) return null;

  await tx.user.update({ where: { id: referral.referrerId }, data: { points: { increment: REFERRAL_REFERRER_POINTS } } });
  await tx.user.update({ where: { id: referral.referredId }, data: { points: { increment: REFERRAL_REFERRED_POINTS } } });

  for (const [userId, points, label] of [
    [referral.referrerId, REFERRAL_REFERRER_POINTS, "دعوتك أثمرت"],
    [referral.referredId, REFERRAL_REFERRED_POINTS, "مكافأة ترحيبية"],
  ] as const) {
    await tx.activity.create({ data: { userId, type: "REFERRAL_REWARDED", message: `${label}: +${points} نقطة`, metadata: { referralId: referral.id, points } } });
    await tx.notification.create({ data: { userId, type: "REFERRAL_REWARDED", title: label, body: `تم إضافة ${points} نقطة إلى رصيدك.`, metadata: { referralId: referral.id, points } } });
  }

  return referral;
}
