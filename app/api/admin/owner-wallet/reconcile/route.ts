import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

export const runtime = "nodejs";

const schema = z.object({
  deltaUsd: z.string().trim().regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "INVALID_RECONCILIATION_AMOUNT"),
  expectedBalanceUsd: z.string().trim().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/, "INVALID_EXPECTED_BALANCE"),
  reason: z.string().trim().min(10).max(500),
  idempotencyKey: z.string().trim().min(8).max(200),
  confirm: z.literal(true),
});

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:owner-wallet-reconcile", 5);
  if (blocked) return blocked;
  try {
    const owner = await requireOwner();
    const body = schema.parse(await request.json());
    const delta = new Prisma.Decimal(body.deltaUsd);
    const expected = new Prisma.Decimal(body.expectedBalanceUsd);
    if (!delta.isFinite() || delta.isZero()) return NextResponse.json({ error: "RECONCILIATION_DELTA_REQUIRED" }, { status: 400 });
    if (!expected.isFinite() || expected.isNegative()) return NextResponse.json({ error: "INVALID_EXPECTED_BALANCE" }, { status: 400 });

    const result = await db.$transaction(async (tx) => {
      const wallet = await tx.ownerWallet.findUnique({ where: { ownerId: owner.id } });
      if (!wallet) throw new Error("OWNER_WALLET_NOT_FOUND");
      const current = new Prisma.Decimal(wallet.availableUsd.toString());
      if (!current.equals(expected)) throw new Error("OWNER_CASH_BALANCE_CHANGED");
      const ledgerKey = "owner-usd-reconcile:" + body.idempotencyKey;
      const existing = await tx.ownerLedger.findUnique({ where: { idempotencyKey: ledgerKey } });
      if (existing) {
        if (existing.walletId !== wallet.id || existing.usdAmount?.toString() !== delta.toString()) throw new Error("IDEMPOTENCY_KEY_CONFLICT");
        return { existing, before: current, after: current.add(delta), replayed: true };
      }
      const after = current.add(delta);
      if (after.isNegative()) throw new Error("OWNER_CASH_BALANCE_CANNOT_BE_NEGATIVE");
      const updated = await tx.ownerWallet.updateMany({ where: { id: wallet.id, availableUsd: current }, data: { availableUsd: after } });
      if (updated.count !== 1) throw new Error("OWNER_CASH_BALANCE_CHANGED");
      const ledger = await tx.ownerLedger.create({
        data: {
          walletId: wallet.id, type: "ADJUSTMENT", points: 0, usdAmount: delta, currency: "USD",
          idempotencyKey: ledgerKey,
          metadata: { kind: "OWNER_USD_CASH_RECONCILIATION", reason: body.reason, beforeUsd: current.toString(), afterUsd: after.toString(), deltaUsd: delta.toString(), expectedBalanceUsd: expected.toString() },
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: owner.id, action: "OWNER_USD_CASH_RECONCILED", entityType: "OwnerWallet", entityId: wallet.id,
          metadata: { ledgerId: ledger.id, reason: body.reason, beforeUsd: current.toString(), afterUsd: after.toString(), deltaUsd: delta.toString() },
        },
      });
      return { existing: ledger, before: current, after, replayed: false };
    });
    return NextResponse.json({ ok: true, replayed: result.replayed, beforeUsd: result.before.toString(), afterUsd: result.after.toString(), ledgerId: result.existing.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OWNER_CASH_RECONCILIATION_FAILED";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : message === "OWNER_WALLET_NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}