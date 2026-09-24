const FAZERCARDS_BASE_URL = "https://api.fzr.cards/api/v2";

type FazerCardsRequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  idempotencyKey?: string;
};

export type FazerCardsCategory = {
  category_id: string;
  name: string;
  note?: string;
};

export type FazerCardsGiftCard = {
  card_id: string;
  category_id: string;
  name?: string;
  denomination?: number;
  denomination_currency?: string;
  price_usd?: number;
  stock?: number;
  min_quantity?: number;
  max_quantity?: number;
  [key: string]: unknown;
};

export type FazerCardsOrderCard = {
  code?: string;
  [key: string]: unknown;
};

export type FazerCardsOrder = {
  id?: string;
  order_id?: string;
  status?: string;
  category_id?: string;
  card_id?: string;
  quantity?: number;
  cards?: FazerCardsOrderCard[];
  [key: string]: unknown;
};

function getApiKey(): string {
  const apiKey = process.env.FAZER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("FAZER_API_KEY is not configured");
  }

  return apiKey;
}

function getSafeErrorDetails(data: unknown): string {
  if (typeof data === "string") {
    return data.slice(0, 500);
  }

  if (typeof data !== "object" || data === null) {
    return "";
  }

  const record = data as Record<string, unknown>;

  const usefulFields = [
    "message",
    "error",
    "detail",
    "code",
    "status",
    "reason",
  ];

  const details: Record<string, unknown> = {};

  for (const field of usefulFields) {
    if (field in record) {
      details[field] = record[field];
    }
  }

  if (Object.keys(details).length > 0) {
    return JSON.stringify(details).slice(0, 1000);
  }

  return JSON.stringify(data).slice(0, 1000);
}

function isBotChallenge(status: number, text: string): boolean {
  return status === 403 && /ddos-guard/i.test(text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fazerCardsRequest<T>(
  path: string,
  options: FazerCardsRequestOptions = {},
): Promise<T> {
  const apiKey = getApiKey();
  const method = options.method ?? "GET";

  // Only read requests are retried automatically. A purchase (POST) is
  // never retried here, so money can never be spent twice by a retry.
  const maxAttempts = method === "GET" ? 3 : 1;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-API-Key": apiKey,
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${FAZERCARDS_BASE_URL}${path}`, {
      method,
      headers,
      body:
        options.body === undefined
          ? undefined
          : JSON.stringify(options.body),
      cache: "no-store",
    });

    const text = await response.text();

    if (!response.ok && isBotChallenge(response.status, text)) {
      if (attempt < maxAttempts) {
        await sleep(600 * attempt);
        continue;
      }

      throw new Error(
        `FazerCards blocked the request with a DDoS-Guard challenge (status 403) after ${attempt} attempt(s)`,
      );
    }

    let data: unknown = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      const details = getSafeErrorDetails(data);

      throw new Error(
        details
          ? `FazerCards API request failed with status ${response.status}: ${details}`
          : `FazerCards API request failed with status ${response.status}`,
      );
    }

    return data as T;
  }
}

/**
 * Get the current FazerCards account information.
 */
export async function getFazerCardsMe(): Promise<unknown> {
  return fazerCardsRequest<unknown>("/me");
}

/**
 * Get the current FazerCards account balance.
 */
export async function getFazerCardsBalance(): Promise<unknown> {
  return fazerCardsRequest<unknown>("/balance");
}

/**
 * Get available gift-card categories.
 */
export async function getFazerCardsCategories(): Promise<{
  ok: boolean;
  kind: string;
  items: FazerCardsCategory[];
}> {
  return fazerCardsRequest("/giftcards?limit=100");
}

/**
 * Finds the list of cards inside a FazerCards response, whatever
 * wrapper the API puts around it.
 */
function extractArray(data: unknown, depth = 0): unknown[] | null {
  if (Array.isArray(data)) return data;
  if (typeof data !== "object" || data === null || depth > 2) return null;

  const record = data as Record<string, unknown>;
  const preferredKeys = ["items", "cards", "data", "results", "result", "offers", "products"];

  for (const key of preferredKeys) {
    const value = record[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) return value;
    if (typeof value === "object" && value !== null) {
      const nested = extractArray(value, depth + 1);
      if (nested) return nested;
      const values = Object.values(value as Record<string, unknown>);
      if (
        values.length > 0 &&
        values.every((item) => typeof item === "object" && item !== null && !Array.isArray(item))
      ) {
        return values;
      }
    }
  }

  for (const value of Object.values(record)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
      return value;
    }
  }

  return null;
}

/**
 * Get available cards/offers for a specific category.
 *
 * Example:
 * getFazerCardsCards("playstation_sa")
 */
export async function getFazerCardsCards(
  categoryId: string,
): Promise<FazerCardsGiftCard[]> {
  if (!categoryId.trim()) {
    throw new Error("categoryId is required");
  }

  const data = await fazerCardsRequest<unknown>(
    `/giftcards/cards?category_id=${encodeURIComponent(categoryId)}`,
  );

  const list = extractArray(data);

  if (!list) {
    const keys =
      typeof data === "object" && data !== null
        ? Object.keys(data as object).join(", ")
        : typeof data;
    const sample = JSON.stringify(data)?.slice(0, 300) ?? "";
    throw new Error(
      `Unexpected FazerCards cards response format (keys: ${keys}) ${sample}`,
    );
  }

  const cards = list
    .filter((item) => typeof item === "object" && item !== null)
    .map((item) => {
      const record = item as Record<string, unknown>;
      const id = record.card_id ?? record.id ?? record.cardId;
      const name =
        typeof record.name === "string"
          ? record.name
          : typeof record.title === "string"
            ? record.title
            : undefined;

      return {
        ...record,
        card_id: id === undefined || id === null ? "" : String(id),
        category_id: String(record.category_id ?? categoryId),
        name,
      } as FazerCardsGiftCard;
    });

  const missingId = cards.find((card) => !card.card_id);

  if (missingId) {
    throw new Error(
      `FazerCards card has no card_id (fields: ${Object.keys(missingId).join(", ")})`,
    );
  }

  return cards;
}

/**
 * Get FazerCards orders.
 */
export async function getFazerCardsOrders(): Promise<unknown> {
  return fazerCardsRequest<unknown>("/orders");
}

/**
 * Get one FazerCards order by its ID.
 */
export async function getFazerCardsOrder(
  orderId: string,
): Promise<FazerCardsOrder> {
  if (!orderId.trim()) {
    throw new Error("orderId is required");
  }

  return fazerCardsRequest<FazerCardsOrder>(
    `/orders/${encodeURIComponent(orderId)}`,
  );
}

/**
 * Purchase a gift card from FazerCards.
 *
 * IMPORTANT:
 * This function performs a REAL purchase.
 * Do not call it during development/testing unless
 * the account has sufficient balance and a real purchase
 * is intentionally being made.
 */
export async function createFazerCardsGiftCardOrder(input: {
  categoryId: string;
  cardId: string;
  quantity: number;
  idempotencyKey: string;
}): Promise<FazerCardsOrder> {
  const categoryId = input.categoryId.trim();
  const cardId = input.cardId.trim();
  const idempotencyKey = input.idempotencyKey.trim();

  if (!categoryId) {
    throw new Error("categoryId is required");
  }

  if (!cardId) {
    throw new Error("cardId is required");
  }

  if (!Number.isInteger(input.quantity)) {
    throw new Error("quantity must be an integer");
  }

  if (input.quantity < 1 || input.quantity > 100) {
    throw new Error("quantity must be between 1 and 100");
  }

  if (!idempotencyKey) {
    throw new Error("idempotencyKey is required");
  }

  return fazerCardsRequest<FazerCardsOrder>("/giftcards/order", {
    method: "POST",
    idempotencyKey,
    body: {
      category_id: categoryId,
      card_id: cardId,
      quantity: input.quantity,
    },
  });
}
