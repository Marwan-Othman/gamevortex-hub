"use client";

import { useMemo, useState } from "react";

type Category = {
  category_id: string;
  name: string;
  note?: string;
};

type Card = {
  card_id: string;
  name: string;
  denomination: number | null;
  denomination_currency: string | null;
  price_usd: number | null;
  stock: number | null;
};

type ImportedMap = Record<
  string,
  {
    active: boolean;
    priceCents: number;
  }
>;

async function readJson(response: Response) {
  try {
    return (await response.json()) as Record<string, any>;
  } catch {
    return {};
  }
}

function isGooglePlayCategory(category: Category) {
  return /google\s*play/i.test(
    `${category.name} ${category.note ?? ""}`,
  );
}

function isSteamCategory(category: Category) {
  return /steam/i.test(
    `${category.name} ${category.note ?? ""}`,
  );
}

export default function FazerCardsImporter() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [imported, setImported] =
    useState<ImportedMap>({});
  const [markup, setMarkup] = useState("10");
  const [busy, setBusy] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState<string>();
  const [selectedBrand, setSelectedBrand] =
    useState<"all" | "google-play" | "steam">(
      "all",
    );

  const markupNumber = Number(markup);

  const markupValid =
    Number.isFinite(markupNumber) &&
    markupNumber >= 0 &&
    markupNumber <= 500;

  const googlePlayCategories = useMemo(
    () =>
      categories.filter((category) =>
        isGooglePlayCategory(category),
      ),
    [categories],
  );

  const steamCategories = useMemo(
    () =>
      categories.filter((category) =>
        isSteamCategory(category),
      ),
    [categories],
  );

  const visibleCategories = useMemo(() => {
    const normalizedQuery = query
      .trim()
      .toLowerCase();

    return categories
      .filter((category) => {
        if (selectedBrand === "google-play") {
          return isGooglePlayCategory(category);
        }

        if (selectedBrand === "steam") {
          return isSteamCategory(category);
        }

        return true;
      })
      .filter((category) => {
        if (!normalizedQuery) {
          return true;
        }

        return (
          category.name
            .toLowerCase()
            .includes(normalizedQuery) ||
          (category.note ?? "")
            .toLowerCase()
            .includes(normalizedQuery) ||
          category.category_id
            .toLowerCase()
            .includes(normalizedQuery)
        );
      });
  }, [
    categories,
    query,
    selectedBrand,
  ]);

  async function loadCategories() {
    setBusy("categories");
    setMessage(undefined);
    setCards([]);
    setCategoryId("");
    setImported({});

    try {
      const response = await fetch(
        "/api/admin/fazercards/catalog",
        {
          cache: "no-store",
        },
      );

      const data = await readJson(response);

      if (!response.ok || !data.ok) {
        setMessage(
          data.error ===
            "FAZER_API_KEY_NOT_CONFIGURED"
            ? "مفتاح FAZER_API_KEY غير مضاف في إعدادات الاستضافة."
            : `تعذر جلب الفئات: ${
                data.detail ||
                data.error ||
                response.status
              }`,
        );

        return;
      }

      const loadedCategories =
        Array.isArray(data.categories)
          ? (data.categories as Category[])
          : [];

      setCategories(loadedCategories);

      if (!loadedCategories.length) {
        setMessage(
          "لم يرجع FazerCards أي فئات.",
        );

        return;
      }

      const googlePlay =
        loadedCategories.filter(
          isGooglePlayCategory,
        );

      if (googlePlay.length > 0) {
        setSelectedBrand("google-play");
        setQuery("");
        setMessage(
          `تم جلب ${loadedCategories.length} فئة. وجدنا ${googlePlay.length} فئة لـ Google Play.`,
        );
      } else {
        setSelectedBrand("all");
        setMessage(
          `تم جلب ${loadedCategories.length} فئة، لكن لم يظهر Google Play في نتيجة الكتالوج.`,
        );
      }
    } catch {
      setMessage(
        "تعذر الاتصال بالخادم.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function loadCards(id: string) {
    setCategoryId(id);
    setCards([]);
    setImported({});

    if (!id) {
      return;
    }

    setBusy("cards");
    setMessage(undefined);

    try {
      const response = await fetch(
        `/api/admin/fazercards/catalog?categoryId=${encodeURIComponent(
          id,
        )}`,
        {
          cache: "no-store",
        },
      );

      const data = await readJson(response);

      if (!response.ok || !data.ok) {
        setMessage(
          `تعذر جلب البطاقات: ${
            data.detail ||
            data.error ||
            response.status
          }`,
        );

        return;
      }

      const loadedCards =
        Array.isArray(data.cards)
          ? (data.cards as Card[])
          : [];

      setCards(loadedCards);

      setImported(
        (data.imported ?? {}) as ImportedMap,
      );

      if (!loadedCards.length) {
        setMessage(
          "لا توجد بطاقات في هذه الفئة.",
        );
      } else {
        setMessage(
          `تم العثور على ${loadedCards.length} بطاقة.`,
        );
      }
    } catch {
      setMessage(
        "تعذر الاتصال بالخادم.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function importCard(card: Card) {
    if (!markupValid) {
      setMessage(
        "نسبة الربح يجب أن تكون بين 0 و 500.",
      );

      return;
    }

    if (!categoryId) {
      setMessage(
        "اختر فئة أولًا.",
      );

      return;
    }

    setBusy(card.card_id);
    setMessage(undefined);

    try {
      const response = await fetch(
        "/api/admin/fazercards/import",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            categoryId,
            cardId: card.card_id,
            markupPercent: markupNumber,
          }),
        },
      );

      const data = await readJson(response);

      if (!response.ok || !data.ok) {
        setMessage(
          `فشل الاستيراد: ${
            data.detail ||
            data.error ||
            response.status
          }`,
        );

        return;
      }

      setImported((current) => ({
        ...current,
        [card.card_id]: {
          active:
            current[card.card_id]?.active ??
            false,
          priceCents:
            data.priceCents,
        },
      }));

      setMessage(
        data.created
          ? `تم استيراد ${card.name} بنجاح. المنتج غير مفعّل بعد.`
          : `تم تحديث سعر ${card.name}.`,
      );
    } catch {
      setMessage(
        "تعذر الاتصال بالخادم.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      className="glass card"
      style={{
        display: "grid",
        gap: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <button
          className="btn"
          type="button"
          onClick={loadCategories}
          disabled={busy !== null}
        >
          {busy === "categories"
            ? "جاري جلب الكتالوج…"
            : "جلب كتالوج FazerCards"}
        </button>

        <label
          className="muted"
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          نسبة الربح %

          <input
            className="input"
            style={{
              width: 90,
            }}
            inputMode="decimal"
            value={markup}
            onChange={(event) =>
              setMarkup(event.target.value)
            }
            aria-label="نسبة الربح"
          />
        </label>
      </div>

      {categories.length > 0 && (
        <>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <button
              type="button"
              className={`btn ${
                selectedBrand === "google-play"
                  ? ""
                  : "secondary"
              }`}
              onClick={() => {
                setSelectedBrand(
                  "google-play",
                );
                setQuery("");
              }}
              disabled={
                googlePlayCategories.length ===
                0
              }
            >
              🎮 Google Play (
              {googlePlayCategories.length})
            </button>

            <button
              type="button"
              className={`btn ${
                selectedBrand === "steam"
                  ? ""
                  : "secondary"
              }`}
              onClick={() => {
                setSelectedBrand("steam");
                setQuery("");
              }}
              disabled={
                steamCategories.length === 0
              }
            >
              🎮 Steam (
              {steamCategories.length})
            </button>

            <button
              type="button"
              className={`btn ${
                selectedBrand === "all"
                  ? ""
                  : "secondary"
              }`}
              onClick={() => {
                setSelectedBrand("all");
                setQuery("");
              }}
            >
              كل الفئات ({categories.length})
            </button>
          </div>

          <input
            className="input"
            value={query}
            onChange={(event) =>
              setQuery(event.target.value)
            }
            placeholder="ابحث عن Google Play أو Steam أو أي بطاقة..."
            aria-label="البحث في كتالوج FazerCards"
          />

          <p
            className="muted"
            style={{ margin: 0 }}
          >
            إجمالي الفئات:{" "}
            {categories.length}
            {" · "}
            نتائج العرض:{" "}
            {visibleCategories.length}
            {googlePlayCategories.length >
              0 &&
              ` · Google Play: ${googlePlayCategories.length}`}
          </p>

          <select
            className="input"
            value={
              visibleCategories.some(
                (category) =>
                  category.category_id ===
                  categoryId,
              )
                ? categoryId
                : ""
            }
            onChange={(event) =>
              loadCards(event.target.value)
            }
            disabled={busy !== null}
            aria-label="اختر فئة بطاقات"
          >
            <option value="">
              — اختر فئة —
            </option>

            {visibleCategories.map(
              (category) => (
                <option
                  key={category.category_id}
                  value={category.category_id}
                >
                  {isGooglePlayCategory(
                    category,
                  )
                    ? "🎮 "
                    : ""}
                  {category.name}
                </option>
              ),
            )}
          </select>
        </>
      )}

      {message && (
        <p
          className="muted"
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      )}

      {busy === "cards" && (
        <p className="muted">
          جاري جلب بطاقات الفئة…
        </p>
      )}

      {cards.length > 0 && (
        <div
          style={{
            display: "flex",
            justifyContent:
              "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
              }}
            >
              البطاقات المتاحة
            </h2>

            <p
              className="muted"
              style={{
                margin: "4px 0 0",
              }}
            >
              عدد البطاقات: {cards.length}
            </p>
          </div>

          <span className="pill">
            هامش الربح:{" "}
            {markupValid
              ? `${markupNumber}%`
              : "غير صالح"}
          </span>
        </div>
      )}

      <div className="grid">
        {cards.map((card) => {
          const row =
            imported[card.card_id];

          const sell =
            card.price_usd !== null &&
            markupValid
              ? (
                  card.price_usd *
                  (1 +
                    markupNumber / 100)
                ).toFixed(2)
              : null;

          return (
            <article
              className="card product"
              key={card.card_id}
            >
              <div className="product-meta">
                {card.denomination !==
                  null && (
                  <span className="pill">
                    {card.denomination}{" "}
                    {card.denomination_currency ??
                      ""}
                  </span>
                )}

                {card.stock !== null && (
                  <span className="pill">
                    مخزون: {card.stock}
                  </span>
                )}

                {row && (
                  <span className="pill">
                    {row.active
                      ? "مفعّل"
                      : "مستورد - غير مفعّل"}
                  </span>
                )}
              </div>

              <h3
                style={{
                  margin: 0,
                }}
              >
                {card.name}
              </h3>

              <p
                className="muted"
                style={{
                  margin: 0,
                }}
              >
                التكلفة:{" "}
                {card.price_usd !== null
                  ? `$${card.price_usd}`
                  : "غير متوفر"}

                {sell &&
                  ` · سعر البيع: $${sell}`}
              </p>

              <button
                className="btn secondary"
                type="button"
                onClick={() =>
                  importCard(card)
                }
                disabled={
                  busy !== null ||
                  card.price_usd === null
                }
              >
                {busy === card.card_id
                  ? "جاري الاستيراد…"
                  : row
                    ? "تحديث السعر"
                    : "استيراد كمنتج"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
