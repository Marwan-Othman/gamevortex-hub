import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardRead } from "@/lib/api";
import { db } from "@/lib/prisma";
import { getVipAccess } from "@/lib/vip";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "ai:usage", 60);
  if (blocked) return blocked;
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const vip = await getVipAccess(user.id);
  const balance = await db.aiCreditBalance.findUnique({ where: { userId: user.id }, select: { gvcBalance: true } });
  const recent = await db.aiUsageLedger.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { provider: true, operation: true, status: true, gvcUsed: true, gvcRefunded: true, createdAt: true },
  });
  return NextResponse.json({
    vip: { isVip: vip.isVip, planCode: vip.planCode, expiresAt: vip.expiresAt },
    balance: vip.isOwner ? null : balance?.gvcBalance || 0,
    unlimited: vip.isOwner,
    recent,
  });
}
