import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../lib/prisma';
import { requireOwner } from '../../../../lib/auth';
import { validateOwnerWithdrawal, OWNER_POINTS_PER_USD } from '../../../../lib/owner-points';
import { guardMutation } from '../../../../lib/api';

export async function POST(req: NextRequest) {
  const blocked = await guardMutation(req, 'owner:withdraw', 10); if (blocked) return blocked;
  try {
    const owner = await requireOwner(); const body = await req.json(); const points = Number(body.points);
    const key = String(req.headers.get('idempotency-key') ?? body.idempotencyKey ?? '');
    if (!key || key.length > 200) return NextResponse.json({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 400 });
    const usd = validateOwnerWithdrawal(points);
    const result = await db.$transaction(async tx => {
      const wallet = await tx.ownerWallet.findUnique({ where: { ownerId: owner.id } });
      if (!wallet) throw new Error('OWNER_WALLET_NOT_FOUND');
      const existing = await tx.withdrawalRequest.findUnique({ where: { idempotencyKey: key } });
      if (existing) return existing;
      if (wallet.availablePoints < points) throw new Error('INSUFFICIENT_POINTS');
      const w = await tx.withdrawalRequest.create({ data: { ownerWalletId: wallet.id, points, usdAmount: usd, conversionRate: OWNER_POINTS_PER_USD, idempotencyKey: key, status: 'PENDING' } });
      await tx.ownerWallet.update({ where: { id: wallet.id }, data: { availablePoints: { decrement: points }, pendingPoints: { increment: points } } });
      await tx.ownerLedger.create({ data: { walletId: wallet.id, type: 'POINTS_RESERVED', points: -points, usdAmount: usd, conversionRate: OWNER_POINTS_PER_USD, withdrawalId: w.id, idempotencyKey: `${key}:reserve` } });
      await tx.auditLog.create({ data: { actorUserId: owner.id, action: 'OWNER_WITHDRAWAL_REQUESTED', entityType: 'WithdrawalRequest', entityId: w.id, metadata: { points, usd } } });
      return w;
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) { const msg = e instanceof Error ? e.message : 'INTERNAL_ERROR'; const status = ['FORBIDDEN','UNAUTHORIZED'].includes(msg) ? 403 : 400; return NextResponse.json({ error: msg }, { status }); }
}
