import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./prisma";
import { creditPointsInTransaction } from "./points";

const DEFAULT_REFERRER_POINTS = 200;
const DEFAULT_REFERRED_POINTS = 100;

function positiveIntegerFromEnv(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

export const REFERRAL_REFERRER_POINTS = positiveIntegerFromEnv(
  process.env.REFERRAL_REFERRER_POINTS,
  DEFAULT_REFERRER_POINTS,
);

export const REFERRAL_REFERRED_POINTS = positiveIntegerFromEnv(
  process.env.REFERRAL_REFERRED_POINTS,
  DEFAULT_REFERRED_POINTS,
);

function randomCodeSuffix(length = 6) {
  return randomBytes(length)
    .toString("hex")
    .slice(0, length)
    .toUpperCase();
}

function codeFromUsername(
  username: string | null | undefined,
) {
  const base =
    (username || "GV")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, 10) || "GV";

  return `${base}-${randomCodeSuffix()}`;
}

export async function generateUniqueReferralCode(
  username: string | null | undefined,
) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = codeFromUsername(username);

    const existing = await db.user.findUnique({
      where: {
        referralCode: code,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return code;
    }
  }

  return `GV-${randomBytes(12)
    .toString("hex")
    .toUpperCase()}`;
}

export async function ensureReferralCode(
  userId: string,
  username: string | null | undefined,
  existingCode: string | null | undefined,
) {
  if (existingCode?.trim()) {
    return existingCode;
  }

  const code = await generateUniqueReferralCode(username);

  try {
    await db.user.update({
      where: {
        id: userId,
      },
      data: {
        referralCode: code,
      },
    });

    return code;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const refreshed = await db.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          referralCode: true,
        },
      });

      if (refreshed?.referralCode) {
        return refreshed.referralCode;
      }
    }

    throw error;
  }
}

export async function linkReferral(
  referredId: string,
  rawCode: string | undefined | null,
) {
  const code = rawCode?.trim().toUpperCase();

  if (!code) {
    return null;
  }

  const referrer = await db.user.findUnique({
    where: {
      referralCode: code,
    },
    select: {
      id: true,
    },
  });

  if (!referrer || referrer.id === referredId) {
    return null;
  }

  try {
    return await db.referral.create({
      data: {
        referrerId: referrer.id,
        referredId,
        status: "PENDING",
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return null;
    }

    return null;
  }
}

export async function qualifyReferralOnFirstOrder(
  tx: Prisma.TransactionClient,
  referredUserId: string,
) {
  const referral = await tx.referral.findUnique({
    where: {
      referredId: referredUserId,
    },
  });

  if (
    !referral ||
    referral.status !== "PENDING"
  ) {
    return null;
  }

  const completedOrders = await tx.order.count({
    where: {
      userId: referredUserId,
      status: "COMPLETED",
    },
  });

  if (completedOrders !== 1) {
    return null;
  }

  const updated = await tx.referral.updateMany({
    where: {
      id: referral.id,
      status: "PENDING",
    },
    data: {
      status: "REWARDED",
      qualifiedAt: new Date(),
      rewardedAt: new Date(),
      rewardPoints: REFERRAL_REFERRER_POINTS,
    },
  });

  if (updated.count !== 1) {
    return null;
  }

  if (REFERRAL_REFERRER_POINTS > 0) {
    await creditPointsInTransaction(tx, {
      userId: referral.referrerId,
      amount: REFERRAL_REFERRER_POINTS,
      reason: "REFERRAL_REWARD",
      sourceId: referral.id,
      idempotencyKey: `referral:${referral.id}:referrer`,
    });
  }
  if (REFERRAL_REFERRED_POINTS > 0) {
    await creditPointsInTransaction(tx, {
      userId: referral.referredId,
      amount: REFERRAL_REFERRED_POINTS,
      reason: "REFERRAL_WELCOME_REWARD",
      sourceId: referral.id,
      idempotencyKey: `referral:${referral.id}:referred`,
    });
  }

  const rewards = [
    {
      userId: referral.referrerId,
      points: REFERRAL_REFERRER_POINTS,
      title: "دعوتك أثمرت",
    },
    {
      userId: referral.referredId,
      points: REFERRAL_REFERRED_POINTS,
      title: "مكافأة ترحيبية",
    },
  ] as const;

  for (const reward of rewards) {
    await tx.activity.create({
      data: {
        userId: reward.userId,
        type: "REFERRAL_REWARDED",
        message: `${reward.title}: +${reward.points} نقطة`,
        metadata: {
          referralId: referral.id,
          points: reward.points,
        },
      },
    });

    await tx.notification.create({
      data: {
        userId: reward.userId,
        type: "REFERRAL_REWARDED",
        title: reward.title,
        body: `تم إضافة ${reward.points} نقطة إلى رصيدك.`,
        metadata: {
          referralId: referral.id,
          points: reward.points,
        },
      },
    });
  }

  return referral;
}
