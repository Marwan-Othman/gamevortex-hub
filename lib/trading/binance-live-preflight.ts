import { signBinanceEd25519Payload } from "@/lib/trading/binance-ed25519-signer";

const BASE_URL = "https://api.binance.com";
const DEFAULT_RECV_WINDOW = 5_000;

type Fetcher = typeof fetch;

type AccountStatusResponse = {
  canTrade?: boolean;
  canWithdraw?: boolean;
  canDeposit?: boolean;
  accountType?: string;
  permissions?: unknown;
};

type ApiRestrictionsResponse = {
  ipRestrict?: boolean;
  enableReading?: boolean;
  enableWithdrawals?: boolean;
  enableInternalTransfer?: boolean;
  enableMargin?: boolean;
  enableFutures?: boolean;
  enableVanillaOptions?: boolean;
  enableSpotAndMarginTrading?: boolean;
  enablePortfolioMarginTrading?: boolean;
};

export type BinanceLivePreflight = {
  credentialsConfigured: boolean;
  endpoint: "https://api.binance.com";
  account?: {
    canTrade: boolean;
    canWithdraw: boolean;
    canDeposit: boolean;
    accountType: string;
    permissions: string[];
  };
  apiKeyRestrictions?: {
    ipRestrict: boolean;
    enableReading: boolean;
    enableWithdrawals: boolean;
    enableInternalTransfer: boolean;
    enableMargin: boolean;
    enableFutures: boolean;
    enableVanillaOptions: boolean;
    enableSpotAndMarginTrading: boolean;
    enablePortfolioMarginTrading: boolean;
  };
  checks: {
    credentials: boolean;
    spotAccount: boolean;
    tradingEnabled: boolean;
    withdrawalsDisabled: boolean;
    spotTradingOnly: boolean;
    marginDisabled: boolean;
    futuresDisabled: boolean;
    optionsDisabled: boolean;
    portfolioMarginDisabled: boolean;
    internalTransferDisabled: boolean;
    liveFlagEnabled: boolean;
  };
  readyForLiveExecution: boolean;
  blockers: string[];
};

function encodeQuery(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function signedQuery(params: Record<string, string | number>, privateKeyPem: string): string {
  const encoded = encodeQuery(params);
  const signature = signBinanceEd25519Payload(encoded, privateKeyPem);
  return `${encoded}&signature=${encodeURIComponent(signature)}`;
}

async function requestJson(
  fetcher: Fetcher,
  path: string,
  params: Record<string, string | number>,
  apiKey: string,
  privateKeyPem: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(`${BASE_URL}${path}?${signedQuery(params, privateKeyPem)}`, {
      method: "GET",
      headers: { Accept: "application/json", "X-MBX-APIKEY": apiKey },
    });
  } catch {
    throw new Error("BINANCE_LIVE_NETWORK_ERROR");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("BINANCE_LIVE_INVALID_RESPONSE");
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "msg" in payload && typeof payload.msg === "string"
        ? payload.msg
        : `HTTP_${response.status}`;

    if (/restricted location/i.test(message)) {
      throw new Error("BINANCE_LIVE_RESTRICTED_LOCATION");
    }

    throw new Error(`BINANCE_LIVE_${message}`);
  }

  return payload;
}

export function hasBinanceLiveCredentials(): boolean {
  return Boolean(
    process.env.BINANCE_LIVE_API_KEY?.trim() &&
      (process.env.BINANCE_LIVE_API_PRIVATE_KEY?.trim() || process.env.BINANCE_LIVE_API_SECRET?.trim()),
  );
}

export async function getBinanceLivePreflight(fetcher: Fetcher = fetch): Promise<BinanceLivePreflight> {
  const apiKey = process.env.BINANCE_LIVE_API_KEY?.trim();
  const privateKeyPem = process.env.BINANCE_LIVE_API_PRIVATE_KEY?.trim() || process.env.BINANCE_LIVE_API_SECRET?.trim();
  const liveFlagEnabled = process.env.GAMEVORTEX_LIVE_TRADING_ENABLED === "true";
  const credentialsConfigured = Boolean(apiKey && privateKeyPem);

  const baseChecks = {
    credentials: credentialsConfigured,
    spotAccount: false,
    tradingEnabled: false,
    withdrawalsDisabled: false,
    spotTradingOnly: false,
    marginDisabled: false,
    futuresDisabled: false,
    optionsDisabled: false,
    portfolioMarginDisabled: false,
    internalTransferDisabled: false,
    liveFlagEnabled,
  };

  if (!credentialsConfigured) {
    return {
      credentialsConfigured: false,
      endpoint: BASE_URL,
      checks: baseChecks,
      readyForLiveExecution: false,
      blockers: ["BINANCE_LIVE_API_CREDENTIALS_REQUIRED", "GAMEVORTEX_LIVE_TRADING_DISABLED"],
    };
  }

  const timestamp = Date.now();
  const commonParams = { recvWindow: DEFAULT_RECV_WINDOW, timestamp };
  const account = (await requestJson(fetcher, "/api/v3/account", commonParams, apiKey!, privateKeyPem!)) as AccountStatusResponse;
  const restrictions = (await requestJson(fetcher, "/sapi/v1/account/apiRestrictions", commonParams, apiKey!, privateKeyPem!)) as ApiRestrictionsResponse;

  const permissions = Array.isArray(account.permissions)
    ? account.permissions.filter((value): value is string => typeof value === "string").slice(0, 20)
    : [];

  const normalizedAccount = {
    canTrade: account.canTrade === true,
    canWithdraw: account.canWithdraw === true,
    canDeposit: account.canDeposit === true,
    accountType: typeof account.accountType === "string" ? account.accountType.trim().toUpperCase() : "UNKNOWN",
    permissions,
  };

  const normalizedRestrictions = {
    ipRestrict: restrictions.ipRestrict === true,
    enableReading: restrictions.enableReading === true,
    enableWithdrawals: restrictions.enableWithdrawals === true,
    enableInternalTransfer: restrictions.enableInternalTransfer === true,
    enableMargin: restrictions.enableMargin === true,
    enableFutures: restrictions.enableFutures === true,
    enableVanillaOptions: restrictions.enableVanillaOptions === true,
    enableSpotAndMarginTrading: restrictions.enableSpotAndMarginTrading === true,
    enablePortfolioMarginTrading: restrictions.enablePortfolioMarginTrading === true,
  };

  const checks = {
    credentials: true,
    // Binance accountType is the authoritative account-type field. The permissions
    // array can contain trading-group identifiers (for example TRD_GRP_082) instead
    // of the literal SPOT permission, so requiring permissions.includes("SPOT")
    // incorrectly blocks valid Spot accounts.
    spotAccount: normalizedAccount.accountType === "SPOT",
    tradingEnabled: normalizedAccount.canTrade && normalizedRestrictions.enableSpotAndMarginTrading,
    withdrawalsDisabled: !normalizedRestrictions.enableWithdrawals,
    spotTradingOnly:
      normalizedRestrictions.enableSpotAndMarginTrading &&
      !normalizedRestrictions.enableMargin &&
      !normalizedRestrictions.enableFutures &&
      !normalizedRestrictions.enableVanillaOptions &&
      !normalizedRestrictions.enablePortfolioMarginTrading,
    marginDisabled: !normalizedRestrictions.enableMargin,
    futuresDisabled: !normalizedRestrictions.enableFutures,
    optionsDisabled: !normalizedRestrictions.enableVanillaOptions,
    portfolioMarginDisabled: !normalizedRestrictions.enablePortfolioMarginTrading,
    internalTransferDisabled: !normalizedRestrictions.enableInternalTransfer,
    liveFlagEnabled,
  };

  const blockers: string[] = [];
  if (!checks.spotAccount) blockers.push("BINANCE_LIVE_SPOT_ACCOUNT_REQUIRED");
  if (!checks.tradingEnabled) blockers.push("BINANCE_LIVE_SPOT_TRADING_REQUIRED");
  if (!checks.withdrawalsDisabled) blockers.push("BINANCE_LIVE_WITHDRAWALS_MUST_BE_DISABLED");
  if (!checks.marginDisabled) blockers.push("BINANCE_LIVE_MARGIN_MUST_BE_DISABLED");
  if (!checks.futuresDisabled) blockers.push("BINANCE_LIVE_FUTURES_MUST_BE_DISABLED");
  if (!checks.optionsDisabled) blockers.push("BINANCE_LIVE_OPTIONS_MUST_BE_DISABLED");
  if (!checks.portfolioMarginDisabled) blockers.push("BINANCE_LIVE_PORTFOLIO_MARGIN_MUST_BE_DISABLED");
  if (!checks.internalTransferDisabled) blockers.push("BINANCE_LIVE_INTERNAL_TRANSFER_MUST_BE_DISABLED");
  if (!checks.liveFlagEnabled) blockers.push("GAMEVORTEX_LIVE_TRADING_DISABLED");

  return {
    credentialsConfigured,
    endpoint: BASE_URL,
    account: normalizedAccount,
    apiKeyRestrictions: normalizedRestrictions,
    checks,
    readyForLiveExecution: blockers.length === 0,
    blockers,
  };
}
