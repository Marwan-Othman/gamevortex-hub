import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { guardMutation, guardRead, internalError } from "@/lib/api";
import { requireTradingOwner, tradingForbidden } from "@/lib/trading/access";
import { db } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeDecimal(value: { toString(): string } | null | undefined): string | null {
  if (!value) return null;
  const raw = value.toString().trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return null;
  const sign = match[1] === "-" ? "-" : "";
  const integer = match[2].replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const normalized = fraction ? `${integer}.${fraction}` : integer;
  return /^0(?:\.0*)?$/.test(normalized) ? "0" : `${sign}${normalized}`;
}

function amountsEqual(left: { toString(): string } | null | undefined, right: { toString(): string } | null | undefined) {
  const normalizedLeft = normalizeDecimal(left);
  const normalizedRight = normalizeDecimal(right);
  return normalizedLeft !== null && normalizedRight !== null && normalizedLeft === normalizedRight;
}

function errorResponse(code: string, status: number) {
  return NextResponse.json({ error: code }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:trading:wallet-funding", 60);
  if (blocked) return blocked;

  try {
    const owner = await requireTradingOwner();
    const [wallet, ownerWallet, nonUsdTransactions, nonUsdCompletedDeposits, usdLedgerTotals] = await Promise.all([
      db.wallet.findUnique({ where: { userId: owner.id }, select: { balance: true, pendingBalance: true } }),
      db.ownerWallet.findUnique({ where: { ownerId: owner.id }, select: { availableUsd: true } }),
      db.walletTransaction.count({ where: { userId: owner.id, currency: { not: "USD" } } }),
      db.walletDeposit.count({ where: { userId: owner.id, status: "COMPLETED", currency: { not: "USD" } } }),
      db.walletTransaction.aggregate({ where: { userId: owner.id, currency: "USD" }, _sum: { amount: true } }),
    ]);
    // A latest-row match can hide an unreconciled legacy balance. Require the sum
    // of the complete USD transaction ledger to equal the current wallet balance.
    const usdLedgerTotal = usdLedgerTotals._sum.amount;
    const balanceLedgerReconciles = !wallet || amountsEqual(usdLedgerTotal, wallet.balance);
    const sourceCurrencyVerified = nonUsdTransactions === 0 && nonUsdCompletedDeposits === 0 && balanceLedgerReconciles;
    return NextResponse.json({
      ok: true,
      sourceWalletAvailableUsd: wallet?.balance.toString() ?? "0.00",
      sourceWalletPendingUsd: wallet?.pendingBalance.toString() ?? "0.00",
      ownerWalletAvailableUsd: ownerWallet?.availableUsd.toString() ?? "0.00",
      sourceCurrencyVerified,
      sourceCurrencyBlocker: sourceCurrencyVerified ? null : "TRADING_FUNDING_SOURCE_CURRENCY_NOT_VERIFIED",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return tradingForbidden();
    return internalError("admin:trading:wallet-funding:read", error, "FUNDING_BALANCE_READ_FAILED");
  }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:trading:wallet-funding", 5);
  if (blocked) return blocked;

  let ownerId: string;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return tradingForbidden();
    return errorResponse("UNAUTHORIZED", 401);
  }

  const rawKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(rawKey)) return errorResponse("IDEMPOTENCY_KEY_REQUIRED", 400);

  const body = await request.json().catch(() => null) as { amountUsd?: unknown } | null;
  const amountUsd = body?.amountUsd;
  if (typeof amountUsd !== "number" || !Number.isSafeInteger(amountUsd) || amountUsd < 1 || amountUsd > 1000) {
    return errorResponse("INVALID_FUNDING_AMOUNT", 400);
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.walletTransaction.findUnique({ where: { idempotencyKey: rawKey } });
      if (existing) {
        if (
          existing.userId !== ownerId ||
          existing.type !== "ADJUSTMENT" ||
          existing.referenceType !== "TRADING_FUNDING" ||
          existing.amount.toNumber() !== -amountUsd
        ) throw new Error("IDEMPOTENCY_KEY_CONFLICT");
        const [currentOwnerWallet, currentSourceWallet, nonUsdTransactions, nonUsdCompletedDeposits, usdLedgerTotals] = await Promise.all([
          tx.ownerWallet.findUnique({ where: { ownerId } }),
          tx.wallet.findUnique({ where: { userId: ownerId }, select: { balance: true } }),
          tx.walletTransaction.count({ where: { userId: ownerId, currency: { not: "USD" } } }),
          tx.walletDeposit.count({ where: { userId: ownerId, status: "COMPLETED", currency: { not: "USD" } } }),
          tx.walletTransaction.aggregate({ where: { userId: ownerId, currency: "USD" }, _sum: { amount: true } }),
        ]);
        const balanceLedgerReconciles = !currentSourceWallet || amountsEqual(usdLedgerTotals._sum.amount, currentSourceWallet.balance);
        const sourceCurrencyVerified = nonUsdTransactions === 0 && nonUsdCompletedDeposits === 0 && balanceLedgerReconciles;
        return {
          replayed: true,
          amountUsd,
          sourceWalletAvailableUsd: currentSourceWallet?.balance.toString() ?? "0.00",
          ownerWalletAvailableUsd: currentOwnerWallet?.availableUsd.toString() ?? "0.00",
          sourceCurrencyVerified,
          sourceCurrencyBlocker: sourceCurrencyVerified ? null : "TRADING_FUNDING_SOURCE_CURRENCY_NOT_VERIFIED",
        };
      }

      // Wallet has no single-currency field, while deposits and transactions may be USD, EUR, GBP, or ILS.
      // Never label an unconverted mixed-currency balance as USD trading capital.
      const [nonUsdTransactions, nonUsdCompletedDeposits, usdLedgerTotals] = await Promise.all([
        tx.walletTransaction.count({ where: { userId: ownerId, currency: { not: "USD" } } }),
        tx.walletDeposit.count({ where: { userId: ownerId, status: "COMPLETED", currency: { not: "USD" } } }),
        tx.walletTransaction.aggregate({ where: { userId: ownerId, currency: "USD" }, _sum: { amount: true } }),
      ]);
      const sourceWalletSnapshot = await tx.wallet.findUnique({ where: { userId: ownerId }, select: { balance: true } });
      const balanceLedgerReconciles = !sourceWalletSnapshot || amountsEqual(usdLedgerTotals._sum.amount, sourceWalletSnapshot.balance);
      if (nonUsdTransactions > 0 || nonUsdCompletedDeposits > 0 || !balanceLedgerReconciles) {
        throw new Error("TRADING_FUNDING_SOURCE_CURRENCY_NOT_VERIFIED");
      }

      const wallet = await tx.wallet.findUnique({ where: { userId: ownerId } });
      if (!wallet) throw new Error("SOURCE_WALLET_NOT_FOUND");
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Wallet" WHERE "id" = ${wallet.id} FOR UPDATE`);
      const lockedWallet = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const amount = new Prisma.Decimal(amountUsd);

      const debit = await tx.wallet.updateMany({
        where: { id: wallet.id, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });
      if (debit.count !== 1) throw new Error("INSUFFICIENT_WALLET_BALANCE");

      const ownerWallet = await tx.ownerWallet.upsert({
        where: { ownerId },
        create: { ownerId },
        update: {},
      });
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "OwnerWallet" WHERE "id" = ${ownerWallet.id} FOR UPDATE`);
      const lockedOwnerWallet = await tx.ownerWallet.findUniqueOrThrow({ where: { id: ownerWallet.id } });
      const credited = await tx.ownerWallet.update({
        where: { id: ownerWallet.id },
        data: { availableUsd: { increment: amount } },
      });

      await tx.walletTransaction.create({
        data: {
          userId: ownerId,
          walletId: wallet.id,
          type: "ADJUSTMENT",
          amount: amount.neg(),
          balanceBefore: lockedWallet.balance,
          balanceAfter: lockedWallet.balance.sub(amount),
          currency: "USD",
          referenceType: "TRADING_FUNDING",
          referenceId: ownerWallet.id,
          idempotencyKey: rawKey,
          metadata: { direction: "OUT", destination: "OWNER_WALLET", amountUsd },
        },
      });
      await tx.ownerLedger.create({
        data: {
          walletId: ownerWallet.id,
          type: "ADJUSTMENT",
          points: 0,
          usdAmount: amount,
          currency: "USD",
          idempotencyKey: `${rawKey}:owner`,
          metadata: {
            direction: "IN",
            source: "USER_MONEY_WALLET",
            sourceWalletId: wallet.id,
            sourceBalanceBeforeUsd: lockedWallet.balance.toString(),
            sourceBalanceAfterUsd: lockedWallet.balance.sub(amount).toString(),
            ownerBalanceBeforeUsd: lockedOwnerWallet.availableUsd.toString(),
            ownerBalanceAfterUsd: credited.availableUsd.toString(),
          },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: ownerId,
          action: "TRADING_WALLET_FUNDED_FROM_MONEY_WALLET",
          entityType: "OwnerWallet",
          entityId: ownerWallet.id,
          metadata: { amountUsd, sourceWalletId: wallet.id, idempotencyKey: rawKey },
        },
      });

      return {
        replayed: false,
        amountUsd,
        sourceWalletAvailableUsd: lockedWallet.balance.sub(amount).toString(),
        ownerWalletAvailableUsd: credited.availableUsd.toString(),
        sourceCurrencyVerified: true,
        sourceCurrencyBlocker: null,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return NextResponse.json({ ok: true, ...result }, { status: result.replayed ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "IDEMPOTENCY_KEY_CONFLICT") return errorResponse(code, 409);
    if (code === "SOURCE_WALLET_NOT_FOUND") return errorResponse(code, 404);
    if (code === "INSUFFICIENT_WALLET_BALANCE") return errorResponse(code, 409);
    if (code === "TRADING_FUNDING_SOURCE_CURRENCY_NOT_VERIFIED") return errorResponse(code, 409);
    const prismaCode = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
    if (prismaCode === "P2002") return errorResponse("IDEMPOTENCY_KEY_IN_PROGRESS", 409);
    if (prismaCode === "P2034") return errorResponse("FUNDING_CONCURRENT_UPDATE", 409);
    return internalError("admin:trading:wallet-funding:write", error, "TRADING_WALLET_FUNDING_FAILED");
  }
}
