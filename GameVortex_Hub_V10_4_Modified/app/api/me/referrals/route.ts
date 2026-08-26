import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardRead } from "@/lib/api";
import { ensureReferralCode } from "@/lib/referrals";

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "me:referrals", 60);
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const referralCode = await ensureReferralCode(user.id, user.username, user.referralCode);
    const referrals = await db.referral.findMany({
      where: { referrerId: user.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { referred: { select: { username: true, createdAt: true } } },
    });
    const rewardedCount = referrals.filter((referral) => referral.status === "REWARDED").length;
    const totalPointsEarned = referrals.reduce((sum, referral) => sum + (referral.status === "REWARDED" ? referral.rewardPoints : 0), 0);
    const origin = process.env.APP_ORIGIN?.replace(/\/$/, "");

    return NextResponse.json({
      referralCode,
      referralLink: origin ? `${origin}/auth/register?ref=${referralCode}` : `/auth/register?ref=${referralCode}`,
      points: user.points,
      stats: { totalReferred: referrals.length, rewarded: rewardedCount, pending: referrals.length - rewardedCount, totalPointsEarned },
      referrals: referrals.map((referral) => ({
        id: referral.id,
        username: referral.referred.username,
        status: referral.status,
        rewardPoints: referral.rewardPoints,
        createdAt: referral.createdAt,
        rewardedAt: referral.rewardedAt,
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "UNAUTHORIZED" }, { status: 401 });
  }
}
