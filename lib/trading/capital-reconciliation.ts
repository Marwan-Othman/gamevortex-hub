import { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import { hasBinanceSigningCredential, signBinancePayload } from "@/lib/trading/binance-signer";

const BINANCE_BASE_URL = "https://api.binance.com";
const RECV_WINDOW = 5_000;

type BinanceBalance = { asset?: string; free?: string; locked?: string };
type BinanceAccount = { balances?: BinanceBalance[] };

export type TradingCapitalReconciliation = {
  internal: {
    ownerWalletAvailableUsd: string;
    tradingAccountBalanceUsd: string;
    activeAllocationsUsd: string;
    boundActiveAllocationsUsd: string;
    openTradeExposureUsd: string;
  };
  binance: {
    configured: boolean;
    reachable: boolean;
    usdtFreeUsd: string;
    usdtLockedUsd: string;
    usdtTotalUsd: string;
  };
  comparison: {
    balanceDeltaUsd: string | null;
    status:
      | "NOT_CONFIGURED"
      | "PROVIDER_UNAVAILABLE"
      | "NO_INTERNAL_CAPITAL"
      | "MISMATCH"
      | "BALANCE_MATCH_CUSTODY_UNVERIFIED";
    custodyVerified: false;
  };
  generatedAt: string;
};

function decimal(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

async function fetchBinanceUsdt(): Promise<{ free: Prisma.Decimal; locked: Prisma.Decimal }> {
  const apiKey = process.env.BINANCE_LIVE_API_KEY?.trim();
  const credentials = {
    apiPrivateKeyPem: process.env.BINANCE_LIVE_API_PRIVATE_KEY?.trim(),
    apiSecret: process.env.BINANCE_LIVE_API_SECRET?.trim(),
  };
  if (!apiKey || !hasBinanceSigningCredential(credentials)) {
    throw new Error("BINANCE_LIVE_API_CREDENTIALS_REQUIRED");
  }

  const query = `recvWindow=${RECV_WINDOW}&timestamp=${Date.now()}`;
  const signature = signBinancePayload(query, credentials);
  let response: Response;
  try {
    response = await fetch(
      `${BINANCE_BASE_URL}/api/v3/account?${query}&signature=${encodeURIComponent(signature)}`,
      { method: "GET", headers: { Accept: "application/json", "X-MBX-APIKEY": apiKey }, cache: "no-store" },
    );
  } catch {
    throw new Error("BINANCE_LIVE_NETWORK_ERROR");
  }

  if (!response.ok) throw new Error("BINANCE_LIVE_PROVIDER_ERROR");
  const payload = (await response.json()) as BinanceAccount;
  const usdt = payload.balances?.find((item) => item.asset === "USDT");
  const free = decimal(usdt?.free ?? "0");
  const locked = decimal(usdt?.locked ?? "0");
  if (!free.isFinite() || !locked.isFinite() || free.isNegative() || locked.isNegative()) {
    throw new Error("BINANCE_LIVE_INVALID_BALANCE");
  }
  return { free, locked };
}

export async function getTradingCapitalReconciliation(ownerId: string): Promise<TradingCapitalReconciliation> {
  const [wallet, account] = await Promise.all([
    db.ownerWallet.findUnique({ where: { ownerId }, select: { availableUsd: true } }),
    db.tradingAccount.findUnique({ where: { ownerId }, select: { id: true, balanceUsd: true } }),
  ]);

  const activeAllocations = account
    ? await db.tradingAllocation.aggregate({
        where: { accountId: account.id, status: "ACTIVE" },
        _sum: { amountUsd: true },
      })
    : null;

  const boundAllocations = account
    ? await db.tradingAllocation.aggregate({
        where: { accountId: account.id, status: "ACTIVE", relatedTradeId: { not: null } },
        _sum: { amountUsd: true },
      })
    : null;

  const openTrades = account
    ? await db.$queryRaw<Array<{ exposure: Prisma.Decimal | null }>>(Prisma.sql`
        SELECT COALESCE(SUM("amountUsd"), 0)::numeric AS "exposure"
        FROM "TradingLiveOrder"
        WHERE "ownerId" = ${ownerId}
          AND "settlementStatus" IS DISTINCT FROM 'SETTLED'
          AND "status" IN ('SUBMITTING', 'SUBMITTED', 'PARTIALLY_FILLED', 'UNKNOWN', 'PROTECTION_PENDING', 'PROTECTED')
      `)
    : [];

  const internalBalance = account?.balanceUsd ?? decimal("0");
  const activeUsd = decimal(activeAllocations?._sum.amountUsd ?? 0);
  const boundUsd = decimal(boundAllocations?._sum.amountUsd ?? 0);
  const exposureValue = openTrades[0]?.exposure;
  const exposureUsd = exposureValue === null || exposureValue === undefined
    ? decimal("0")
    : decimal(exposureValue.toString());

  const base = {
    internal: {
      ownerWalletAvailableUsd: (wallet?.availableUsd ?? decimal("0")).toString(),
      tradingAccountBalanceUsd: internalBalance.toString(),
      activeAllocationsUsd: activeUsd.toString(),
      boundActiveAllocationsUsd: boundUsd.toString(),
      openTradeExposureUsd: exposureUsd.toString(),
    },
    generatedAt: new Date().toISOString(),
  };

  const configured = Boolean(
    process.env.BINANCE_LIVE_API_KEY?.trim() &&
    hasBinanceSigningCredential({
      apiPrivateKeyPem: process.env.BINANCE_LIVE_API_PRIVATE_KEY,
      apiSecret: process.env.BINANCE_LIVE_API_SECRET,
    }),
  );

  if (!configured) {
    return {
      ...base,
      binance: { configured: false, reachable: false, usdtFreeUsd: "0", usdtLockedUsd: "0", usdtTotalUsd: "0" },
      comparison: {
        balanceDeltaUsd: null,
        status: "NOT_CONFIGURED",
        custodyVerified: false,
      },
    };
  }

  let binance: { free: Prisma.Decimal; locked: Prisma.Decimal };
  try {
    binance = await fetchBinanceUsdt();
  } catch (error) {
    if (error instanceof Error && error.message === "BINANCE_LIVE_NETWORK_ERROR") {
      return {
        ...base,
        binance: { configured: true, reachable: false, usdtFreeUsd: "0", usdtLockedUsd: "0", usdtTotalUsd: "0" },
        comparison: { balanceDeltaUsd: null, status: "PROVIDER_UNAVAILABLE", custodyVerified: false },
      };
    }
    throw error;
  }

  const total = binance.free.add(binance.locked);
  const delta = total.sub(internalBalance);
  const hasInternalCapital = internalBalance.gt(0) || activeUsd.gt(0);
  const status = !hasInternalCapital
    ? "NO_INTERNAL_CAPITAL"
    : delta.eq(0)
      ? "BALANCE_MATCH_CUSTODY_UNVERIFIED"
      : "MISMATCH";

  return {
    ...base,
    binance: {
      configured: true,
      reachable: true,
      usdtFreeUsd: binance.free.toString(),
      usdtLockedUsd: binance.locked.toString(),
      usdtTotalUsd: total.toString(),
    },
    comparison: {
      balanceDeltaUsd: delta.toString(),
      status,
      custodyVerified: false,
    },
  };
}
