import { signBinancePayload, hasBinanceSigningCredential } from "@/lib/trading/binance-signer";

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

function signedQuery(
  params: Record<string, string | number>,
  credentials: { apiPrivateKeyPem?: string; apiSecret?: string },
): string {
  const encoded = encodeQuery(params);
  const signature = signBinancePayload(encoded, credentials);
  return `${encoded}&signature=${encodeURIComponent(signature)}`;
}

function providerErrorCode(status: number, message: string | null, code: unknown): string {
  const normalized = (message ?? "").toLowerCase();
  const numericCode = typeof code === "number" ? code : Number(code);

  if (/restricted location|service unavailable from/i.test(message ?? "")) return "BINANCE_LIVE_RESTRICTED_LOCATION";
  if (
    status === 401 ||
    numericCode === -1002 ||
    numericCode === -2015 ||
    normalized.includes("invalid api-key") ||
    normalized.includes("invalid api key")
  ) return "BINANCE_LIVE_API_AUTH_FAILED";
  if (numericCode === -1021 || normalized.includes("recvwindow") || normalized.includes("timestamp")) return "BINANCE_LIVE_TIMESTAMP_INVALID";
  if (numericCode === -1022 || normalized.includes("signature")) return "BINANCE_LIVE_SIGNATURE_INVALID";
  if (status === 429 || status === 418 || numericCode === -1003 || normalized.includes("too many requests")) return "BINANCE_LIVE_RATE_LIMITED";
  return "BINANCE_LIVE_PROVIDER_ERROR";
}

async function requestJson(
  fetcher: Fetcher,
  path: string,
  params: Record<string, string | number>,
  apiKey: string,
  credentials: { apiPrivateKeyPem?: string; apiSecret?: string },
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(`${BASE_URL}${path}?${signedQuery(params, credentials)}`, {
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
    const object = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
    const message = typeof object?.msg === "string" ? object.msg : null;
    throw new Error(providerErrorCode(response.status, message, object?.code));
  }

  return payload;
}

export function hasBinanceLiveCredentials(): boolean {
  return Boolean(
    process.env.BINANCE_LIVE_API_KEY?.trim() &&
      hasBinanceSigningCredential({
        apiPrivateKeyPem: process.env.BINANCE_LIVE_API_PRIVATE_KEY,
        apiSecret: process.env.BINANCE_LIVE_API_SECRET,
      }),
  );
}

export async function getBinanceLivePreflight(fetcher: Fetcher = fetch): Promise<BinanceLivePreflight> {
  const apiKey = process.env.BINANCE_LIVE_API_KEY?.trim();
  const apiPrivateKeyPem = process.env.BINANCE_LIVE_API_PRIVATE_KEY?.trim();
  const apiSecret = process.env.BINANCE_LIVE_API_SECRET?.trim();
  const credentials = { apiPrivateKeyPem, apiSecret };
  const liveFlagEnabled = process.env.GAMEVORTEX_LIVE_TRADING_ENABLED === "true";
  const credentialsConfigured = Boolean(apiKey && hasBinanceSigningCredential(credentials));

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
  const account = (await requestJson(fetcher, "/api/v3/account", commonParams, apiKey!, credentials)) as AccountStatusResponse;
  const restrictions = (await requestJson(fetcher, "/sapi/v1/account/apiRestrictions", commonParams, apiKey!, credentials)) as ApiRestrictionsResponse;

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
