import { PrismaClient } from '@prisma/client';

/**
 * Sends PENDING owner withdrawals to the payout provider.
 *
 * Money safety rules this script follows:
 *  1. A withdrawal is CLAIMED with a conditional update (PENDING -> PROCESSING),
 *     so two overlapping runs can never both pay the same request.
 *  2. Reserved points are returned ONLY when the provider definitively rejected
 *     the payout (HTTP 4xx). If the outcome is unknown (timeout, network error,
 *     5xx, or the database write after a successful payout failed) the request
 *     stays PROCESSING for manual review. Returning the points in that case
 *     could let the owner be paid twice.
 *  3. Ledger rows use the same idempotency keys as the admin withdrawals route
 *     (/api/admin/withdrawals/[id]) and never repeat points that were already
 *     deducted when the withdrawal was reserved, so the two paths cannot
 *     settle or release the same withdrawal twice.
 */
const db = new PrismaClient();

class PayoutRejected extends Error {}
class PayoutOutcomeUnknown extends Error {}

const providerName = process.env.PAYOUT_PROVIDER || 'external';

async function payout(input) {
  const base = process.env.PAYOUT_PROVIDER_BASE_URL;
  const secret = process.env.PAYOUT_PROVIDER_SECRET;
  if (!base || !secret) throw new Error('PAYOUT_PROVIDER_NOT_CONFIGURED');

  let response;
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/payouts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.withdrawalId,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    // The request may or may not have reached the provider.
    throw new PayoutOutcomeUnknown(error instanceof Error ? error.message : 'PAYOUT_NETWORK_ERROR');
  }

  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;
  const reason = String(data?.error || `PAYOUT_PROVIDER_HTTP_${response.status}`);
  if (response.status >= 400 && response.status < 500) throw new PayoutRejected(reason);
  throw new PayoutOutcomeUnknown(reason);
}

async function recordAudit(action, withdrawalId, metadata) {
  try {
    await db.auditLog.create({ data: { action, entityType: 'WithdrawalRequest', entityId: withdrawalId, metadata } });
  } catch (error) {
    console.error(JSON.stringify({ event: 'audit_write_failed', action, withdrawalId, error: String(error) }));
  }
}

async function settle(w, result, paid) {
  const providerTransactionId = String(result.providerTransactionId || result.id || '');
  await db.$transaction(async (tx) => {
    const moved = await tx.withdrawalRequest.updateMany({
      where: { id: w.id, status: 'PROCESSING' },
      data: {
        status: paid ? 'PAID' : 'PROCESSING',
        providerTransactionId,
        provider: providerName,
        processedAt: paid ? new Date() : null,
      },
    });
    if (moved.count !== 1) throw new Error('WITHDRAWAL_NOT_PROCESSING');

    if (paid) {
      const released = await tx.ownerWallet.updateMany({
        where: { id: w.ownerWalletId, pendingPoints: { gte: w.points } },
        data: { pendingPoints: { decrement: w.points } },
      });
      if (released.count !== 1) throw new Error('OWNER_WALLET_RESERVATION_MISMATCH');
    }

    await tx.ownerLedger.create({
      data: {
        walletId: w.ownerWalletId,
        type: paid ? 'PAYOUT_SETTLED' : 'PAYOUT_PENDING',
        points: 0, // the points were already deducted by POINTS_RESERVED
        usdAmount: w.usdAmount,
        currency: w.currency,
        conversionRate: w.conversionRate,
        withdrawalId: w.id,
        provider: providerName,
        providerTransactionId,
        idempotencyKey: paid ? `withdrawal:${w.id}:payout-settled` : `withdrawal:${w.id}:payout-pending`,
        metadata: { source: 'process-withdrawals' },
      },
    });
  });
}

async function releaseRejected(w, reason) {
  await db.$transaction(async (tx) => {
    const moved = await tx.withdrawalRequest.updateMany({
      where: { id: w.id, status: 'PROCESSING' },
      data: { status: 'FAILED', failureReason: reason.slice(0, 500), processedAt: new Date() },
    });
    if (moved.count !== 1) throw new Error('WITHDRAWAL_NOT_PROCESSING');

    const returned = await tx.ownerWallet.updateMany({
      where: { id: w.ownerWalletId, pendingPoints: { gte: w.points } },
      data: { pendingPoints: { decrement: w.points }, availablePoints: { increment: w.points } },
    });
    if (returned.count !== 1) throw new Error('OWNER_WALLET_RESERVATION_MISMATCH');

    await tx.ownerLedger.create({
      data: {
        walletId: w.ownerWalletId,
        type: 'POINTS_RETURNED',
        points: w.points,
        usdAmount: w.usdAmount,
        currency: w.currency,
        conversionRate: w.conversionRate,
        withdrawalId: w.id,
        provider: providerName,
        idempotencyKey: `withdrawal:${w.id}:points-returned`,
        metadata: { reason, source: 'process-withdrawals' },
      },
    });
  });
}

const destination = process.env.OWNER_EXTERNAL_WALLET_ADDRESS;
if (!destination || !process.env.PAYOUT_PROVIDER_BASE_URL || !process.env.PAYOUT_PROVIDER_SECRET) {
  // A configuration problem is not a reason to reject anybody's withdrawal.
  console.error(JSON.stringify({ event: 'payout_not_configured', note: 'no withdrawal was touched' }));
  await db.$disconnect();
  process.exit(1);
}

const rows = await db.withdrawalRequest.findMany({ where: { status: 'PENDING' }, take: 25, orderBy: { createdAt: 'asc' } });

for (const w of rows) {
  // Claim. Only one runner can win this conditional update.
  const claim = await db.withdrawalRequest.updateMany({
    where: { id: w.id, status: 'PENDING' },
    data: { status: 'PROCESSING', provider: providerName },
  });
  if (claim.count !== 1) continue;

  let result;
  try {
    result = await payout({ withdrawalId: w.id, amount: Number(w.usdAmount), currency: w.currency, destination });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'PAYOUT_FAILED';
    if (error instanceof PayoutRejected) {
      try {
        await releaseRejected(w, reason);
        console.error(JSON.stringify({ withdrawalId: w.id, status: 'FAILED', reason }));
      } catch (releaseError) {
        console.error(JSON.stringify({ withdrawalId: w.id, status: 'NEEDS_MANUAL_REVIEW', reason, releaseError: String(releaseError) }));
        await recordAudit('WITHDRAWAL_RELEASE_FAILED', w.id, { reason, releaseError: String(releaseError) });
      }
    } else {
      // Unknown outcome: the payout may have been sent. Keep the points reserved.
      console.error(JSON.stringify({ withdrawalId: w.id, status: 'NEEDS_MANUAL_REVIEW', reason }));
      await recordAudit('WITHDRAWAL_PAYOUT_OUTCOME_UNKNOWN', w.id, { reason });
    }
    continue;
  }

  const paid = result.status === 'PAID';
  try {
    await settle(w, result, paid);
    console.log(JSON.stringify({ withdrawalId: w.id, status: paid ? 'PAID' : 'PROCESSING' }));
  } catch (error) {
    // The provider accepted the payout but the bookkeeping failed. Never
    // release the points; keep what the provider returned so it can be settled
    // by hand from the admin withdrawals screen.
    const info = { withdrawalId: w.id, providerTransactionId: String(result.providerTransactionId || result.id || ''), providerStatus: result.status, error: String(error) };
    console.error(JSON.stringify({ ...info, status: 'NEEDS_MANUAL_SETTLEMENT' }));
    await recordAudit('WITHDRAWAL_PAYOUT_SENT_BOOKKEEPING_FAILED', w.id, info);
  }
}

await db.$disconnect();
