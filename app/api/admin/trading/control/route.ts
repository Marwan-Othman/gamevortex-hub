import { NextRequest, NextResponse } from "next/server";
import { guardMutation, guardRead } from "@/lib/api";
import { requireTradingOwner } from "@/lib/trading/access";
import { TradingInputError } from "@/lib/trading/errors";
import {
  activateEmergencyStop,
  clearEmergencyStop,
  getTradingControl,
  resetCircuitBreaker,
} from "@/lib/trading/control-service";
import { controlBlockReasons } from "@/lib/trading/control";
import { readJsonObject, tradingRouteError } from "@/lib/trading/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function view(control: {
  emergencyStopped: boolean;
  emergencyStoppedAt: Date | null;
  emergencyReason: string | null;
  circuitBreakerReasons: string[];
}) {
  return {
    emergencyStopped: control.emergencyStopped,
    emergencyStoppedAt: control.emergencyStoppedAt,
    emergencyReason: control.emergencyReason,
    circuitBreakerReasons: control.circuitBreakerReasons,
    blockReasons: controlBlockReasons(control),
  };
}

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:trading:control", 60);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;
    const { control } = await getTradingControl(owner.id);
    return NextResponse.json({ ok: true, control: view(control) });
  } catch (error) {
    return tradingRouteError(error, "admin:trading:control:get", ownerId);
  }
}

// Actions: EMERGENCY_STOP, CLEAR_EMERGENCY_STOP (confirm), RESET_CIRCUIT_BREAKER (confirm).
// The Circuit Breaker is tripped by the system only, never through this API.
export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:trading:control", 10);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    const body = await readJsonObject(request);
    const action = body.action;

    let control;
    if (action === "EMERGENCY_STOP") {
      const reason = typeof body.reason === "string" ? body.reason : undefined;
      control = await activateEmergencyStop({ ownerId: owner.id, reason });
    } else if (action === "CLEAR_EMERGENCY_STOP") {
      control = await clearEmergencyStop({ ownerId: owner.id, confirm: body.confirm });
    } else if (action === "RESET_CIRCUIT_BREAKER") {
      control = await resetCircuitBreaker({ ownerId: owner.id, confirm: body.confirm });
    } else {
      throw new TradingInputError("INVALID_CONTROL_ACTION", "action");
    }

    return NextResponse.json({ ok: true, control: view(control) });
  } catch (error) {
    return tradingRouteError(error, "admin:trading:control:post", ownerId);
  }
}
