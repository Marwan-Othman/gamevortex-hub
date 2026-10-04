/**
 * GameVortex AI Trading — Shariah Guard.
 *
 * This module is a policy enforcement layer, not a source of religious rulings.
 * A real-money policy must be reviewed by a qualified Islamic-finance scholar.
 * Unknown or unverifiable facts fail closed with REVIEW.
 */

export const SHARIAH_STATUSES = ["APPROVED", "REVIEW", "REJECTED"] as const;
export type ShariahStatus = (typeof SHARIAH_STATUSES)[number];

export type TradingMethod =
  | "SPOT"
  | "MARGIN"
  | "LEVERAGED"
  | "SHORT"
  | "FUTURES"
  | "OPTIONS"
  | "UNKNOWN";

export type ShariahFinancialRatios = {
  interestBearingDebtRatio?: number;
  interestIncomeRatio?: number;
  impermissibleIncomeRatio?: number;
};

export type ShariahAssetInput = {
  symbol: string;
  assetType: string;
  issuer?: string;
  businessActivity?: string;
  financialRatios?: ShariahFinancialRatios;
  tradingMethod: TradingMethod;
  ownershipSettlementVerified: boolean;
  source?: string;
};

export type ShariahPolicy = {
  version: string;
  prohibitedBusinessKeywords: readonly string[];
  prohibitedMethods: readonly TradingMethod[];
  /** Allowlist. Anything not listed here can never be APPROVED. Defaults to SPOT only. */
  allowedMethods?: readonly TradingMethod[];
  maxInterestBearingDebtRatio?: number;
  maxInterestIncomeRatio?: number;
  maxImpermissibleIncomeRatio?: number;
  /**
   * Asset types for which company-style financial ratios (debt/interest income)
   * do not exist (e.g. spot DIGITAL_ASSET). For these the ratio screening is
   * skipped. Leave undefined for live trading policies.
   */
  financialScreeningNotApplicableAssetTypes?: readonly string[];
};

export type ShariahDecision = {
  status: ShariahStatus;
  symbol: string;
  policyVersion: string;
  reasons: string[];
  checkedAt: string;
};

export const DEFAULT_SHARIAH_POLICY: ShariahPolicy = {
  version: "v1.0",
  prohibitedBusinessKeywords: [
    "alcohol",
    "casino",
    "gambling",
    "betting",
    "pornography",
    "adult entertainment",
    "recreational drugs",
    "pork",
    "conventional bank",
    "interest-based lending",
    "خمور",
    "قمار",
    "مقامرة",
    "ميسر",
    "مراهنات",
    "كازينو",
    "إباحية",
    "مخدرات",
    "بنك ربوي",
  ],
  prohibitedMethods: ["MARGIN", "LEVERAGED", "SHORT", "FUTURES", "OPTIONS", "UNKNOWN"],
};

/**
 * Policy for SIMULATION ONLY (Paper Trading). Not a religious ruling and not
 * valid for real money: DEFAULT_SHARIAH_POLICY stays strict for live paths.
 */
export const PAPER_SIMULATION_SHARIAH_POLICY: ShariahPolicy = {
  ...DEFAULT_SHARIAH_POLICY,
  version: "paper-sim-v1",
  financialScreeningNotApplicableAssetTypes: ["DIGITAL_ASSET"],
};

const DEFAULT_ALLOWED_METHODS: readonly TradingMethod[] = ["SPOT"];

function normalized(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function ratioIsKnown(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function containsProhibitedBusiness(activity: string, policy: ShariahPolicy): string | undefined {
  const match = policy.prohibitedBusinessKeywords.find((keyword) =>
    activity.includes(normalized(keyword)),
  );
  return match;
}

/**
 * Evaluate an asset using a versioned policy. The function fails closed:
 * missing information produces REVIEW, while explicit prohibited activity or
 * prohibited methods produce REJECTED.
 */
export function evaluateShariah(
  input: ShariahAssetInput,
  policy: ShariahPolicy = DEFAULT_SHARIAH_POLICY,
): ShariahDecision {
  const reasons: string[] = [];
  const activity = normalized(input.businessActivity);
  const method = input.tradingMethod;
  const ratios = input.financialRatios;

  if (!input.symbol.trim() || !input.assetType.trim()) {
    reasons.push("ASSET_IDENTITY_INCOMPLETE");
  }

  // Fail closed: an unknown business activity can never pass screening.
  if (!activity) {
    reasons.push("BUSINESS_ACTIVITY_UNKNOWN");
  }

  const prohibitedBusiness = containsProhibitedBusiness(activity, policy);
  if (prohibitedBusiness) {
    reasons.push(`PROHIBITED_BUSINESS:${prohibitedBusiness}`);
  }

  // Method must be explicitly prohibited (REJECTED) or explicitly allowed (else REVIEW).
  // A value outside the TS union (e.g. from JSON) must not slip through.
  const allowedMethods = policy.allowedMethods ?? DEFAULT_ALLOWED_METHODS;
  if (policy.prohibitedMethods.includes(method)) {
    reasons.push(`PROHIBITED_TRADING_METHOD:${method}`);
  } else if (!allowedMethods.includes(method)) {
    reasons.push(`TRADING_METHOD_NOT_ALLOWED:${String(method)}`);
  }

  if (!input.ownershipSettlementVerified) {
    reasons.push("OWNERSHIP_OR_SETTLEMENT_NOT_VERIFIED");
  }

  const ratioRules: Array<[keyof ShariahFinancialRatios, number | undefined, string]> = [
    ["interestBearingDebtRatio", policy.maxInterestBearingDebtRatio, "INTEREST_BEARING_DEBT_RATIO"],
    ["interestIncomeRatio", policy.maxInterestIncomeRatio, "INTEREST_INCOME_RATIO"],
    ["impermissibleIncomeRatio", policy.maxImpermissibleIncomeRatio, "IMPERMISSIBLE_INCOME_RATIO"],
  ];

  const ratiosNotApplicable = (policy.financialScreeningNotApplicableAssetTypes ?? [])
    .map((type) => type.trim().toUpperCase())
    .includes(input.assetType.trim().toUpperCase());

  for (const [key, threshold, label] of ratioRules) {
    if (ratiosNotApplicable || threshold === undefined) continue;
    const value = ratios?.[key];
    if (!ratioIsKnown(value)) {
      reasons.push(`FINANCIAL_SCREENING_DATA_MISSING:${label}`);
    } else if (value > threshold) {
      reasons.push(`FINANCIAL_SCREENING_FAILED:${label}`);
    }
  }

  const financialPolicyConfigured = ratiosNotApplicable || ratioRules.every(([, threshold]) => threshold !== undefined);
  if (!financialPolicyConfigured) reasons.push("FINANCIAL_SCREENING_POLICY_NOT_CONFIGURED");

  const hasMissingFinancialData = !ratiosNotApplicable && ratioRules.some(([key, threshold]) => threshold !== undefined && !ratioIsKnown(ratios?.[key]));
  const hasRejectedReason = reasons.some((reason) =>
    reason.startsWith("PROHIBITED_") || reason.startsWith("FINANCIAL_SCREENING_FAILED") || reason === "ASSET_IDENTITY_INCOMPLETE",
  );

  const status: ShariahStatus = hasRejectedReason
    ? "REJECTED"
    : !financialPolicyConfigured || hasMissingFinancialData || reasons.length > 0
      ? "REVIEW"
      : "APPROVED";

  return {
    status,
    symbol: input.symbol.trim().toUpperCase(),
    policyVersion: policy.version,
    reasons,
    checkedAt: new Date().toISOString(),
  };
}

export function assertShariahApproved(decision: ShariahDecision): void {
  if (decision.status !== "APPROVED") {
    throw new Error(`SHARIAH_${decision.status}`);
  }
}

/** State of the stored policy row (ShariahPolicy) that a decision was made under. */
export type PolicyReviewState = {
  status: "ACTIVE" | "INACTIVE";
  reviewedAt: Date | string | null;
};

/**
 * Review gate: a policy that is not ACTIVE and reviewed by a qualified
 * specialist can never produce APPROVED. APPROVED is downgraded to REVIEW;
 * REVIEW and REJECTED are unchanged. Missing policy state also fails closed.
 */
export function applyPolicyReviewGate(
  decision: ShariahDecision,
  policyState: PolicyReviewState | null | undefined,
): ShariahDecision {
  if (decision.status !== "APPROVED") return decision;

  const reviewed = !!policyState && policyState.status === "ACTIVE" && !!policyState.reviewedAt;
  if (reviewed) return decision;

  return {
    ...decision,
    status: "REVIEW",
    reasons: [...decision.reasons, "POLICY_NOT_REVIEWED_OR_NOT_ACTIVE"],
  };
}
