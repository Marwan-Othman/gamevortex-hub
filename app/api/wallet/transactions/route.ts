import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { guardRead } from "@/lib/api";
import { db } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "wallet:transactions", 60);
  if (blocked) return blocked;
  const user = await requireUser();
  const wallet = await db.wallet.findUnique({ where: { userId: user.id }, select: { balance: true, pendingBalance: true } });
  const transactions = await db.walletTransaction.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, type: true, amount: true, balanceBefore: true, balanceAfter: true, currency: true, referenceType: true, referenceId: true, createdAt: true },
  });
  return NextResponse.json({ ok: true, wallet, transactions });
}
