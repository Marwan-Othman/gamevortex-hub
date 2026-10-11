import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "../lib/prisma";
import {
  createLiveOrderIntent,
  getLiveOrderByIdempotencyKey,
  listMonitorableLiveOrders,
  transitionLiveOrderState,
} from "../lib/trading/live-order-state";

/**
 * DB-backed state drills run only in the isolated PostgreSQL service created by
 * .github/workflows/trading-quality.yml. Vercel builds intentionally skip them:
 * a deployment build must never create or mutate rows in a connected database.
 */
const enabled = process.env.GAMEVORTEX_TRADING_DB_DRILLS === "true";
const ownerIds: string[] = [];
const idempotencyKeys: string[] = [];

async function makeFixture() {
  const token = randomUUID().replace(/-/g, "");
  const ownerId = `test-owner-${token}`;
  const idempotencyKey = `test-live-drill:${token}`;

  await db.user.create({
    data: {
      id: ownerId,
      email: `${ownerId}@example.invalid`,
      role: "SUPER_ADMIN",
    },
  });

  ownerIds.push(ownerId);
  idempotencyKeys.push(idempotencyKey);

  return {
    ownerId,
    input: {
      ownerId,
      approvalId: `approval-${token}`,
      opportunityId: `opportunity-${token}`,
      idempotencyKey,
      symbol: "BTCUSDT",
      amountUsd: "10.00",
      entryPrice: "100.00",
      stopLossPrice: "95.00",
      takeProfitPrice: "110.00",
    },
  };
}

afterEach(async () => {
  // These deletions only target synthetic fixtures created by this test suite.
  for (const idempotencyKey of idempotencyKeys.splice(0)) {
    await db.$executeRaw(
      Prisma.sql`DELETE FROM "TradingLiveOrder" WHERE "idempotencyKey" = ${idempotencyKey}`,
    );
  }

  for (const ownerId of ownerIds.splice(0)) {
    await db.user.delete({ where: { id: ownerId } }).catch(() => undefined);
  }
});

describe.skipIf(!enabled)("live order database failure drills", () => {
  it("concurrent retries with one idempotency key create only one immutable order intent", async () => {
    const { input } = await makeFixture();

    const orders = await Promise.all([
      createLiveOrderIntent(input),
      createLiveOrderIntent(input),
      createLiveOrderIntent(input),
    ]);

    expect(new Set(orders.map((order) => order.id)).size).toBe(1);
    expect(new Set(orders.map((order) => order.clientOrderId)).size).toBe(1);

    const stored = await getLiveOrderByIdempotencyKey(input.idempotencyKey);
    expect(stored?.id).toBe(orders[0].id);
    expect(stored?.status).toBe("INTENT_CREATED");

    await expect(
      createLiveOrderIntent({ ...input, amountUsd: "11.00" }),
    ).rejects.toThrow("LIVE_ORDER_IDEMPOTENCY_CONFLICT:AMOUNT_MISMATCH");
  });

  it("does not expose an unsubmitted INTENT_CREATED row to the live monitor", async () => {
    const { input } = await makeFixture();
    const created = await createLiveOrderIntent(input);

    const monitorable = await listMonitorableLiveOrders(50);
    expect(monitorable.some((order) => order.id === created.id)).toBe(false);

    const stored = await getLiveOrderByIdempotencyKey(input.idempotencyKey);
    expect(stored?.status).toBe("INTENT_CREATED");
  });

  it("recovers an ambiguous submit timeout only through provider reconciliation", async () => {
    const { input } = await makeFixture();
    const created = await createLiveOrderIntent(input);

    const submitting = await transitionLiveOrderState(created.id, "INTENT_CREATED", "SUBMITTING");
    expect(submitting.status).toBe("SUBMITTING");

    // A timeout after submission is ambiguous: never assume rejection or resubmit a BUY.
    const unknown = await transitionLiveOrderState(created.id, "SUBMITTING", "UNKNOWN", "SIMULATED_TIMEOUT_AFTER_SUBMIT");
    expect(unknown.status).toBe("UNKNOWN");

    const monitorable = await listMonitorableLiveOrders(50);
    expect(monitorable.some((order) => order.id === created.id)).toBe(true);

    // Only an explicit provider observation can resolve UNKNOWN back to a known state.
    const reconciled = await transitionLiveOrderState(created.id, "UNKNOWN", "SUBMITTED");
    expect(reconciled.status).toBe("SUBMITTED");

    const stored = await getLiveOrderByIdempotencyKey(input.idempotencyKey);
    expect(stored?.status).toBe("SUBMITTED");
    expect(stored?.clientOrderId).toBe(created.clientOrderId);
  });

  it("a stale state transition loses the race without overwriting the persisted state", async () => {
    const { input } = await makeFixture();
    const created = await createLiveOrderIntent(input);

    const transitioned = await transitionLiveOrderState(
      created.id,
      "INTENT_CREATED",
      "SUBMITTING",
    );
    expect(transitioned.status).toBe("SUBMITTING");

    await expect(
      transitionLiveOrderState(created.id, "INTENT_CREATED", "SUBMITTING"),
    ).rejects.toThrow("LIVE_ORDER_STATE_CONFLICT");

    const stored = await getLiveOrderByIdempotencyKey(input.idempotencyKey);
    expect(stored?.status).toBe("SUBMITTING");
    expect(stored?.version).toBe(transitioned.version);
  });
});
