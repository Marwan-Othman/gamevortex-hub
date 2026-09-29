import { Prisma } from "@prisma/client";
import { db } from "../prisma";
import { isCircuitBreakerReason, controlBlockReasons } from "./control";
import { TradingInputError } from "./errors";

type Tx = Prisma.TransactionClient;

/**
 * Lock the TradingControl row (creating it if needed) so concurrent changes
 * cannot lose an update. A brand-new control row starts STOPPED: the owner
 * must explicitly clear the emergency stop before trading can be unblocked.
 */
async function lockedControl(tx: Tx, ownerId: string) {
  const control = await tx.tradingControl.upsert({
    where: { ownerId },
    create: {
      ownerId,
      emergencyStopped: true,
      emergencyStoppedAt: new Date(),
      emergencyReason: "INITIAL_SETUP_NOT_CLEARED",
      circuitBreakerReasons: [],
    },
    update: {},
  });

  await tx.$queryRaw`SELECT "id" FROM "TradingControl" WHERE "id" = ${control.id} FOR UPDATE`;

  return tx.tradingControl.findUniqueOrThrow({ where: { id: control.id } });
}

function audit(tx: Tx, input: { actorUserId: string | null; action: string; entityId: string; metadata: Prisma.InputJsonValue }) {
  return tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: "TradingControl",
      entityId: input.entityId,
      metadata: input.metadata,
    },
  });
}

export async function getTradingControl(ownerId: string) {
  return db.$transaction(async (tx) => {
    const control = await lockedControl(tx, ownerId);
    return { control, blockReasons: controlBlockReasons(control) };
  });
}

export async function activateEmergencyStop(input: { ownerId: string; reason?: string }) {
  const reason = (input.reason ?? "MANUAL_EMERGENCY_STOP").trim().slice(0, 300) || "MANUAL_EMERGENCY_STOP";

  return db.$transaction(async (tx) => {
    const before = await lockedControl(tx, input.ownerId);
    const control = await tx.tradingControl.update({
      where: { id: before.id },
      data: {
        emergencyStopped: true,
        emergencyStoppedAt: before.emergencyStopped ? before.emergencyStoppedAt : new Date(),
        emergencyReason: reason,
      },
    });
    await audit(tx, {
      actorUserId: input.ownerId,
      action: "TRADING_EMERGENCY_STOP",
      entityId: control.id,
      metadata: { reason, wasAlreadyStopped: before.emergencyStopped },
    });
    return control;
  });
}

export async function clearEmergencyStop(input: { ownerId: string; confirm: unknown }) {
  if (input.confirm !== true) throw new TradingInputError("CONFIRMATION_REQUIRED", "confirm");

  return db.$transaction(async (tx) => {
    const before = await lockedControl(tx, input.ownerId);
    const control = await tx.tradingControl.update({
      where: { id: before.id },
      data: { emergencyStopped: false, emergencyStoppedAt: null, emergencyReason: null },
    });
    await audit(tx, {
      actorUserId: input.ownerId,
      action: "TRADING_EMERGENCY_STOP_CLEARED",
      entityId: control.id,
      metadata: { previousReason: before.emergencyReason },
    });
    return control;
  });
}

/**
 * System-only: called by trading services (executor, market data, ...) on a
 * failure. Deliberately NOT exposed through any API route.
 */
export async function tripCircuitBreaker(input: { ownerId: string; reason: string; detail?: string }) {
  if (!isCircuitBreakerReason(input.reason)) throw new TradingInputError("INVALID_CIRCUIT_BREAKER_REASON", "reason");

  return db.$transaction(async (tx) => {
    const before = await lockedControl(tx, input.ownerId);
    const already = before.circuitBreakerReasons.includes(input.reason);
    const control = already
      ? before
      : await tx.tradingControl.update({
          where: { id: before.id },
          data: { circuitBreakerReasons: [...before.circuitBreakerReasons, input.reason] },
        });
    await audit(tx, {
      actorUserId: null,
      action: "TRADING_CIRCUIT_BREAKER_TRIPPED",
      entityId: control.id,
      // Never put secrets or raw exchange responses in `detail`.
      metadata: { reason: input.reason, detail: input.detail?.slice(0, 300) ?? null, alreadyActive: already },
    });
    return control;
  });
}

export async function resetCircuitBreaker(input: { ownerId: string; confirm: unknown }) {
  if (input.confirm !== true) throw new TradingInputError("CONFIRMATION_REQUIRED", "confirm");

  return db.$transaction(async (tx) => {
    const before = await lockedControl(tx, input.ownerId);
    const control = await tx.tradingControl.update({
      where: { id: before.id },
      data: { circuitBreakerReasons: [] },
    });
    await audit(tx, {
      actorUserId: input.ownerId,
      action: "TRADING_CIRCUIT_BREAKER_RESET",
      entityId: control.id,
      metadata: { clearedReasons: before.circuitBreakerReasons },
    });
    return control;
  });
}
