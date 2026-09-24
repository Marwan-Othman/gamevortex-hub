"use client";

import { useEffect, useMemo, useState } from "react";

type Game = {
  id: string;
  slug: string;
  titleAr: string | null;
  titleEn: string | null;
  published: boolean;
};

type Props = {
  onCreated?: () => void;
};

const productKinds = [
  {
    value: "GAME_KEY",
    label: "مفتاح لعبة",
  },
  {
    value: "GIFT_CARD",
    label: "بطاقة هدية",
  },
  {
    value: "TOP_UP",
    label: "شحن رصيد",
  },
  {
    value: "DLC",
    label: "محتوى إضافي DLC",
  },
  {
    value: "SUBSCRIPTION",
    label: "اشتراك",
  },
  {
    value: "DIGITAL_ITEM",
    label: "عنصر رقمي",
  },
] as const;

const deliveryTypes = [
  {
    value: "CODE",
    label: "كود رقمي",
  },
  {
    value: "ACCOUNT_TOPUP",
    label: "شحن حساب",
  },
  {
    value: "EXTERNAL_LINK",
    label: "رابط خارجي",
  },
  {
    value: "MANUAL",
    label: "تسليم يدوي",
  },
] as const;

export default function StoreProductForm({
  onCreated,
}: Props) {
  const [games, setGames] = useState<Game[]>([]);
  const [loadingGames, setLoadingGames] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [gameId, setGameId] = useState("");
  const [sku, setSku] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] =
    useState("");

  const [price, setPrice] = useState("0");
  const [currency, setCurrency] =
    useState("USD");

  const [kind, setKind] =
    useState("GAME_KEY");

  const [deliveryType, setDeliveryType] =
    useState("CODE");

  const [inventory, setInventory] =
    useState("0");

  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("");
  const [provider, setProvider] = useState("");
  const [sourceUrl, setSourceUrl] =
    useState("");

  const [redemptionInstructions, setRedemptionInstructions] =
    useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadGames() {
      try {
        setLoadingGames(true);

        const response = await fetch(
          "/api/admin/games",
          {
            cache: "no-store",
          },
        );

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(
            payload?.error ||
              "FAILED_TO_LOAD_GAMES",
          );
        }

        if (!cancelled) {
          setGames(payload.data ?? []);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? error.message
              : "تعذر تحميل الألعاب",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingGames(false);
        }
      }
    }

    loadGames();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedGame = useMemo(
    () =>
      games.find(
        (game) => game.id === gameId,
      ),
    [games, gameId],
  );

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setMessage("");

    if (!gameId) {
      setMessage("اختر اللعبة أولًا.");
      return;
    }

    const numericPrice = Number(price);
    const numericInventory =
      Number(inventory);

    if (
      !Number.isFinite(numericPrice) ||
      numericPrice < 0
    ) {
      setMessage("السعر غير صالح.");
      return;
    }

    if (
      !Number.isInteger(numericInventory) ||
      numericInventory < 0
    ) {
      setMessage(
        "المخزون يجب أن يكون رقمًا صحيحًا.",
      );
      return;
    }

    try {
      setSaving(true);

      const response = await fetch(
        "/api/admin/products",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            gameId,
            sku,
            title,
            description:
              description.trim() || null,

            priceCents: Math.round(
              numericPrice * 100,
            ),

            currency,

            kind,
            deliveryType,

            inventory: numericInventory,

            region:
              region.trim() || null,

            country:
              country.trim() || null,

            provider:
              provider.trim() || null,

            sourceUrl:
              sourceUrl.trim() || null,

            redemptionInstructions:
              redemptionInstructions.trim() ||
              null,
          }),
        },
      );

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            "PRODUCT_CREATE_FAILED",
        );
      }

      setMessage(
        "تم إنشاء المنتج بنجاح. المنتج غير نشط حاليًا حتى يتم التحقق منه.",
      );

      setSku("");
      setTitle("");
      setDescription("");
      setPrice("0");
      setInventory("0");
      setRegion("");
      setCountry("");
      setProvider("");
      setSourceUrl("");
      setRedemptionInstructions("");

      onCreated?.();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "تعذر إنشاء المنتج.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="glass card"
      style={{ marginTop: "24px" }}
    >
      <div className="section-head">
        <div>
          <h2>إضافة منتج للمتجر</h2>

          <p className="muted">
            إنشاء GameProduct مرتبط بلعبة موجودة
            في النظام. المنتج الجديد يبدأ غير نشط
            حتى تتم مراجعته.
          </p>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          display: "grid",
          gap: "14px",
        }}
      >
        <label>
          <span className="muted">
            اللعبة
          </span>

          <select
            value={gameId}
            onChange={(event) =>
              setGameId(event.target.value)
            }
            disabled={loadingGames || saving}
            style={{
              width: "100%",
              marginTop: "6px",
            }}
          >
            <option value="">
              {loadingGames
                ? "جاري تحميل الألعاب..."
                : "اختر اللعبة"}
            </option>

            {games.map((game) => (
              <option
                key={game.id}
                value={game.id}
              >
                {game.titleAr ||
                  game.titleEn ||
                  game.slug}
                {!game.published
                  ? " — غير منشورة"
                  : ""}
              </option>
            ))}
          </select>
        </label>

        {selectedGame && (
          <div className="badge">
            اللعبة المختارة:{" "}
            {selectedGame.titleAr ||
              selectedGame.titleEn ||
              selectedGame.slug}
          </div>
        )}

        <label>
          <span className="muted">
            SKU
          </span>

          <input
            value={sku}
            onChange={(event) =>
              setSku(event.target.value)
            }
            placeholder="مثال: GAME-STEAM-001"
            required
            disabled={saving}
          />
        </label>

        <label>
          <span className="muted">
            اسم المنتج
          </span>

          <input
            value={title}
            onChange={(event) =>
              setTitle(event.target.value)
            }
            placeholder="مثال: Steam Key"
            required
            disabled={saving}
          />
        </label>

        <label>
          <span className="muted">
            الوصف
          </span>

          <textarea
            value={description}
            onChange={(event) =>
              setDescription(
                event.target.value,
              )
            }
            rows={4}
            placeholder="وصف المنتج..."
            disabled={saving}
          />
        </label>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "12px",
          }}
        >
          <label>
            <span className="muted">
              السعر
            </span>

            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(event) =>
                setPrice(event.target.value)
              }
              required
              disabled={saving}
            />
          </label>

          <label>
            <span className="muted">
              العملة
            </span>

            <input
              value={currency}
              onChange={(event) =>
                setCurrency(
                  event.target.value.toUpperCase(),
                )
              }
              maxLength={10}
              placeholder="USD"
              required
              disabled={saving}
            />
          </label>

          <label>
            <span className="muted">
              النوع
            </span>

            <select
              value={kind}
              onChange={(event) =>
                setKind(event.target.value)
              }
              disabled={saving}
            >
              {productKinds.map((item) => (
                <option
                  key={item.value}
                  value={item.value}
                >
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="muted">
              طريقة التسليم
            </span>

            <select
              value={deliveryType}
              onChange={(event) =>
                setDeliveryType(
                  event.target.value,
                )
              }
              disabled={saving}
            >
              {deliveryTypes.map((item) => (
                <option
                  key={item.value}
                  value={item.value}
                >
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="muted">
              المخزون
            </span>

            <input
              type="number"
              min="0"
              step="1"
              value={inventory}
              onChange={(event) =>
                setInventory(
                  event.target.value,
                )
              }
              disabled={saving}
            />
          </label>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "12px",
          }}
        >
          <label>
            <span className="muted">
              المنطقة
            </span>

            <input
              value={region}
              onChange={(event) =>
                setRegion(event.target.value)
              }
              placeholder="Global"
              disabled={saving}
            />
          </label>

          <label>
            <span className="muted">
              الدولة
            </span>

            <input
              value={country}
              onChange={(event) =>
                setCountry(event.target.value)
              }
              placeholder="AE"
              disabled={saving}
            />
          </label>

          <label>
            <span className="muted">
              المورد
            </span>

            <input
              value={provider}
              onChange={(event) =>
                setProvider(event.target.value)
              }
              placeholder="اسم المورد"
              disabled={saving}
            />
          </label>
        </div>

        <label>
          <span className="muted">
            رابط المصدر
          </span>

          <input
            type="url"
            value={sourceUrl}
            onChange={(event) =>
              setSourceUrl(event.target.value)
            }
            placeholder="https://..."
            disabled={saving}
          />
        </label>

        <label>
          <span className="muted">
            تعليمات الاسترداد
          </span>

          <textarea
            value={redemptionInstructions}
            onChange={(event) =>
              setRedemptionInstructions(
                event.target.value,
              )
            }
            rows={4}
            placeholder="تعليمات استخدام الكود..."
            disabled={saving}
          />
        </label>

        {message && (
          <div
            className="badge"
            role="status"
          >
            {message}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <button
            type="submit"
            className="btn"
            disabled={saving}
          >
            {saving
              ? "جاري الحفظ..."
              : "إضافة المنتج"}
          </button>
        </div>
      </form>
    </section>
  );
}
