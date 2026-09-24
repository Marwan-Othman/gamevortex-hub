"use client";

import { useState } from "react";

type Product = {
  id: string;
  sku: string;
  title: string;
  description: string | null;
  priceCents: number;
  currency: string;
  active: boolean;
  inventory: number | null;
  kind: string;
  deliveryType: string;
  region: string | null;
  country: string | null;
  provider: string | null;
  supplierVerified: boolean;
  game: {
    id: string;
    titleAr: string | null;
    titleEn: string | null;
    slug: string;
  };
  orderItems: number;
  digitalKeys: number;
};

type Props = {
  product: Product;
};

export default function StoreProductActions({
  product,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const [title, setTitle] = useState(product.title);

  const [price, setPrice] = useState(
    (product.priceCents / 100).toFixed(2),
  );

  const [inventory, setInventory] = useState(
    product.inventory === null
      ? ""
      : String(product.inventory),
  );

  const [provider, setProvider] = useState(
    product.provider ?? "",
  );

  const [region, setRegion] = useState(
    product.region ?? "",
  );

  const [country, setCountry] = useState(
    product.country ?? "",
  );

  const [keyText, setKeyText] = useState("");

  const canUseDigitalKeys =
    product.deliveryType === "CODE" &&
    product.kind === "GAME_KEY";

  async function updateProduct(
    data: Record<string, unknown>,
  ) {
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/products/${product.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data),
        },
      );

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            "PRODUCT_UPDATE_FAILED",
        );
      }

      window.location.reload();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "تعذر تحديث المنتج.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function publishProduct() {
    const confirmed = window.confirm(
      `سيظهر "${product.title}" في متجر المستخدمين بعد النشر.\n\nهل تريد نشر المنتج؟`,
    );

    if (!confirmed) return;

    await updateProduct({
      active: true,
      supplierVerified: true,
    });
  }

  async function unpublishProduct() {
    const confirmed = window.confirm(
      `سيتم إخفاء "${product.title}" من متجر المستخدمين.\n\nهل تريد إلغاء النشر؟`,
    );

    if (!confirmed) return;

    await updateProduct({
      active: false,
    });
  }

  async function handleSave() {
    const numericPrice = Number(price);

    const numericInventory =
      inventory.trim() === ""
        ? null
        : Number(inventory);

    if (
      !Number.isFinite(numericPrice) ||
      numericPrice < 0
    ) {
      setMessage("السعر غير صالح.");
      return;
    }

    if (
      numericInventory !== null &&
      (!Number.isInteger(numericInventory) ||
        numericInventory < 0)
    ) {
      setMessage(
        "المخزون يجب أن يكون رقمًا صحيحًا.",
      );
      return;
    }

    await updateProduct({
      title: title.trim(),
      priceCents: Math.round(
        numericPrice * 100,
      ),
      inventory: numericInventory,
      provider:
        provider.trim() || null,
      region:
        region.trim() || null,
      country:
        country.trim() || null,
    });
  }

  async function importKeys() {
    const codes = [
      ...new Set(
        keyText
          .split(/\r?\n/)
          .map((code) => code.trim())
          .filter(Boolean),
      ),
    ];

    if (!codes.length) {
      setMessage(
        "أدخل مفتاحًا واحدًا على الأقل.",
      );
      return;
    }

    if (codes.length > 500) {
      setMessage(
        "يمكن إضافة 500 مفتاح كحد أقصى في العملية الواحدة.",
      );
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/products/${product.id}/keys`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            codes,
          }),
        },
      );

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            "DIGITAL_KEY_IMPORT_FAILED",
        );
      }

      setKeyText("");

      setMessage(
        `تمت إضافة ${payload.inserted ?? codes.length} مفتاحًا. المخزون المتاح الآن: ${payload.available ?? "غير معروف"}.`,
      );

      window.location.reload();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "تعذر إضافة المفاتيح.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      `هل أنت متأكد من حذف المنتج "${product.title}"؟\n\nلن يسمح النظام بالحذف إذا كان المنتج مرتبطًا بطلبات أو مفاتيح رقمية.`,
    );

    if (!confirmed) return;

    setSaving(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/admin/products/${product.id}`,
        {
          method: "DELETE",
        },
      );

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(
          payload?.error ||
            "PRODUCT_DELETE_FAILED",
        );
      }

      window.location.reload();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "تعذر حذف المنتج.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        marginTop: "18px",
        display: "grid",
        gap: "10px",
      }}
    >
      {/* النشر */}
      <div
        className="glass"
        style={{
          padding: "14px",
          display: "grid",
          gap: "10px",
        }}
      >
        <div>
          <strong>
            حالة ظهور المنتج للمستخدمين
          </strong>

          <p
            className="muted"
            style={{
              marginTop: "5px",
            }}
          >
            {product.active
              ? "المنتج نشط ويمكن أن يظهر في المتجر إذا استوفى شروط البيع."
              : "المنتج مخفي حاليًا عن متجر المستخدمين."}
          </p>
        </div>

        <div
          style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
          }}
        >
          {!product.active && (
            <button
              type="button"
              className="btn"
              onClick={publishProduct}
              disabled={saving}
            >
              {saving
                ? "جاري النشر..."
                : "🚀 نشر في متجر المستخدمين"}
            </button>
          )}

          {product.active && (
            <button
              type="button"
              className="btn secondary"
              onClick={unpublishProduct}
              disabled={saving}
            >
              {saving
                ? "جاري الإخفاء..."
                : "إخفاء من متجر المستخدمين"}
            </button>
          )}
        </div>
      </div>

      {/* تعديل */}
      {editing && (
        <div
          className="glass"
          style={{
            padding: "14px",
            display: "grid",
            gap: "10px",
          }}
        >
          <label>
            <span className="muted">
              اسم المنتج
            </span>

            <input
              value={title}
              onChange={(event) =>
                setTitle(event.target.value)
              }
              disabled={saving}
              style={{
                width: "100%",
                marginTop: "5px",
              }}
            />
          </label>

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
              disabled={saving}
              style={{
                width: "100%",
                marginTop: "5px",
              }}
            />
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
              placeholder="فارغ = غير محدد"
              style={{
                width: "100%",
                marginTop: "5px",
              }}
            />
          </label>

          <label>
            <span className="muted">
              المورد
            </span>

            <input
              value={provider}
              onChange={(event) =>
                setProvider(
                  event.target.value,
                )
              }
              disabled={saving}
              style={{
                width: "100%",
                marginTop: "5px",
              }}
            />
          </label>

          <label>
            <span className="muted">
              المنطقة
            </span>

            <input
              value={region}
              onChange={(event) =>
                setRegion(
                  event.target.value,
                )
              }
              disabled={saving}
              style={{
                width: "100%",
                marginTop: "5px",
              }}
            />
          </label>

          <label>
            <span className="muted">
              الدولة
            </span>

            <input
              value={country}
              onChange={(event) =>
                setCountry(
                  event.target.value,
                )
              }
              disabled={saving}
              style={{
                width: "100%",
                marginTop: "5px",
              }}
            />
          </label>

          <div
            style={{
              display: "flex",
              gap: "8px",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="btn"
              onClick={handleSave}
              disabled={saving}
            >
              {saving
                ? "جاري الحفظ..."
                : "حفظ التعديلات"}
            </button>

            <button
              type="button"
              className="btn secondary"
              onClick={() =>
                setEditing(false)
              }
              disabled={saving}
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {/* المفاتيح */}
      {canUseDigitalKeys && (
        <div
          className="glass"
          style={{
            padding: "14px",
            display: "grid",
            gap: "10px",
          }}
        >
          <div>
            <strong>
              🔐 مفاتيح المنتج الرقمية
            </strong>

            <p className="muted">
              المفاتيح تحفظ مشفرة ولا تظهر
              في لوحة الإدارة بعد إدخالها.
            </p>
          </div>

          <button
            type="button"
            className="btn secondary"
            onClick={() =>
              setShowKeys((value) => !value)
            }
            disabled={saving}
          >
            {showKeys
              ? "إغلاق إدارة المفاتيح"
              : "إضافة مفاتيح"}
          </button>

          {showKeys && (
            <>
              <textarea
                value={keyText}
                onChange={(event) =>
                  setKeyText(
                    event.target.value,
                  )
                }
                disabled={saving}
                rows={8}
                placeholder={
                  "ضع كل مفتاح في سطر مستقل\nXXXXX-XXXXX-XXXXX\nXXXXX-XXXXX-XXXXX"
                }
              />

              <button
                type="button"
                className="btn"
                onClick={importKeys}
                disabled={saving}
              >
                {saving
                  ? "جاري الحفظ..."
                  : "حفظ المفاتيح"}
              </button>
            </>
          )}
        </div>
      )}

      {/* الأزرار العامة */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          className="btn secondary"
          onClick={() =>
            setEditing(
              (value) => !value,
            )
          }
          disabled={saving}
        >
          {editing
            ? "إغلاق التعديل"
            : "تعديل المنتج"}
        </button>

        <button
          type="button"
          className="btn secondary"
          onClick={handleDelete}
          disabled={
            saving ||
            product.orderItems > 0 ||
            product.digitalKeys > 0
          }
        >
          حذف المنتج
        </button>
      </div>

      {product.digitalKeys > 0 && (
        <p className="muted">
          لا يمكن حذف المنتج لأنه يحتوي
          على {product.digitalKeys} مفتاحًا
          رقميًا.
        </p>
      )}

      {product.orderItems > 0 && (
        <p className="muted">
          لا يمكن حذف المنتج لأنه مرتبط
          بـ {product.orderItems} طلبًا سابقًا.
        </p>
      )}

      {message && (
        <div
          className="badge"
          role="status"
        >
          {message}
        </div>
      )}
    </div>
  );
}
