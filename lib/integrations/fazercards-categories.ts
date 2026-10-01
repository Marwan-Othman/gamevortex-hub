const FAZERCARDS_BASE_URL = "https://api.fzr.cards/api/v2";

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const TIME_BUDGET_MS = 25000;

export type FazerCardsCategoryItem = {
  category_id: string;
  name: string;
  note?: string;
};

type ApiRecord = Record<string, unknown>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(value: unknown): ApiRecord | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as ApiRecord;
}

function extractItems(data: unknown): FazerCardsCategoryItem[] {
  const record = asRecord(data);

  if (!record) {
    return [];
  }

  const candidates = [
    record.items,
    record.categories,
    record.data,
    record.results,
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    const result: FazerCardsCategoryItem[] = [];

    for (const item of candidate) {
      const itemRecord = asRecord(item);

      if (!itemRecord) {
        continue;
      }

      const categoryId =
        itemRecord.category_id ??
        itemRecord.categoryId ??
        itemRecord.id;

      const name =
        itemRecord.name ??
        itemRecord.title ??
        itemRecord.label;

      if (
        typeof categoryId === "string" &&
        categoryId.trim() &&
        typeof name === "string" &&
        name.trim()
      ) {
        result.push({
          category_id: categoryId.trim(),
          name: name.trim(),
          ...(typeof itemRecord.note === "string"
            ? { note: itemRecord.note }
            : {}),
        });
      }
    }

    if (result.length > 0) {
      return result;
    }
  }

  return [];
}

function getNextCursor(data: unknown): string | null {
  const record = asRecord(data);

  if (!record) {
    return null;
  }

  const meta = asRecord(record.meta);

  const candidates = [
    record.next_cursor,
    record.nextCursor,
    record.next_page_token,
    meta?.next_cursor,
    meta?.nextCursor,
    meta?.next_page_token,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function getHasMore(data: unknown): boolean {
  const record = asRecord(data);

  if (!record) {
    return false;
  }

  const meta = asRecord(record.meta);

  const candidates = [
    record.has_more,
    record.hasMore,
    meta?.has_more,
    meta?.hasMore,
  ];

  return candidates.some((value) => value === true);
}

async function fetchCategoriesPage(
  query: string,
): Promise<unknown> {
  const apiKey = process.env.FAZER_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "FAZER_API_KEY is not configured",
    );
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(
      `${FAZERCARDS_BASE_URL}/giftcards?${query}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-API-Key": apiKey,
        },
        cache: "no-store",
      },
    );

    const text = await response.text();

    if (
      response.status === 403 &&
      /ddos-guard/i.test(text)
    ) {
      if (attempt < 3) {
        await sleep(700 * attempt);
        continue;
      }

      throw new Error(
        "FazerCards blocked the request with a DDoS-Guard challenge (status 403)",
      );
    }

    if (!response.ok) {
      throw new Error(
        `FazerCards API request failed with status ${response.status}: ${text.slice(
          0,
          500,
        )}`,
      );
    }

    try {
      return text ? JSON.parse(text) : {};
    } catch {
      throw new Error(
        "FazerCards returned a response that is not JSON",
      );
    }
  }

  throw new Error(
    "FazerCards category request failed",
  );
}

function mergeCategories(
  target: Map<string, FazerCardsCategoryItem>,
  data: unknown,
): number {
  const items = extractItems(data);

  let added = 0;

  for (const item of items) {
    if (!target.has(item.category_id)) {
      target.set(item.category_id, item);
      added += 1;
      continue;
    }

    const existing = target.get(item.category_id);

    if (
      existing &&
      (!existing.note || existing.note.length === 0) &&
      item.note
    ) {
      target.set(item.category_id, {
        ...existing,
        note: item.note,
      });
    }
  }

  return added;
}

/**
 * Loads the complete gift-card category catalog.
 *
 * FazerCards documents cursor pagination for /giftcards.
 * We first use the documented cursor returned by the API.
 *
 * For compatibility with older responses, offset/page pagination
 * is used only when no cursor is provided.
 */
export async function getAllFazerCardsCategories(): Promise<{
  items: FazerCardsCategoryItem[];
  pages: number;
  strategy: string;
  meta: Record<string, unknown>;
}> {
  const startedAt = Date.now();

  const all = new Map<
    string,
    FazerCardsCategoryItem
  >();

  const first = await fetchCategoriesPage(
    `limit=${PAGE_SIZE}`,
  );

  mergeCategories(all, first);

  const firstRecord = asRecord(first);
  const firstItems = extractItems(first);

  const meta =
    firstRecord &&
    typeof firstRecord.meta === "object" &&
    firstRecord.meta !== null &&
    !Array.isArray(firstRecord.meta)
      ? (firstRecord.meta as Record<string, unknown>)
      : {};

  let pages = 1;
  let strategy = "single";

  let cursor = getNextCursor(first);
  const hasMore = getHasMore(first);

  /**
   * Preferred documented pagination.
   */
  if (
    cursor ||
    (hasMore && firstItems.length > 0)
  ) {
    strategy = "cursor";

    const seenCursors = new Set<string>();

    while (
      cursor &&
      pages < MAX_PAGES &&
      Date.now() - startedAt < TIME_BUDGET_MS
    ) {
      if (seenCursors.has(cursor)) {
        break;
      }

      seenCursors.add(cursor);

      const data = await fetchCategoriesPage(
        `limit=${PAGE_SIZE}&cursor=${encodeURIComponent(
          cursor,
        )}`,
      );

      pages += 1;

      const added = mergeCategories(
        all,
        data,
      );

      const nextCursor =
        getNextCursor(data);

      if (!nextCursor || added === 0) {
        break;
      }

      cursor = nextCursor;
    }
  }

  /**
   * Compatibility fallback.
   *
   * Some FazerCards responses may not expose
   * the cursor in the expected location.
   */
  if (
    strategy === "single" &&
    firstItems.length >= PAGE_SIZE &&
    Date.now() - startedAt < TIME_BUDGET_MS
  ) {
    const strategies = [
      {
        name: "offset",
        query: (page: number, loaded: number) =>
          `limit=${PAGE_SIZE}&offset=${loaded}`,
      },
      {
        name: "page",
        query: (page: number) =>
          `limit=${PAGE_SIZE}&page=${page}`,
      },
    ];

    for (const candidate of strategies) {
      const before = all.size;
      let progressed = false;

      for (
        let page = 2;
        page <= MAX_PAGES &&
        Date.now() - startedAt < TIME_BUDGET_MS;
        page += 1
      ) {
        const data =
          await fetchCategoriesPage(
            candidate.query(
              page,
              all.size,
            ),
          );

        const added =
          mergeCategories(all, data);

        if (added === 0) {
          break;
        }

        progressed = true;
        pages = Math.max(
          pages,
          page,
        );

        const pageItems =
          extractItems(data);

        if (
          pageItems.length <
          PAGE_SIZE
        ) {
          break;
        }
      }

      if (progressed || all.size > before) {
        strategy = candidate.name;
        break;
      }
    }
  }

  /**
   * Google Play is intentionally checked here.
   *
   * We do not invent category IDs.
   * We only make sure all returned Google Play
   * categories remain visible to the importer.
   */
  const items = Array.from(
    all.values(),
  ).sort((a, b) => {
    const aGoogle =
      /google\s*play/i.test(a.name)
        ? 0
        : 1;

    const bGoogle =
      /google\s*play/i.test(b.name)
        ? 0
        : 1;

    if (aGoogle !== bGoogle) {
      return aGoogle - bGoogle;
    }

    return a.name.localeCompare(
      b.name,
      undefined,
      {
        sensitivity: "base",
      },
    );
  });

  return {
    items,
    pages,
    strategy,
    meta,
  };
}
