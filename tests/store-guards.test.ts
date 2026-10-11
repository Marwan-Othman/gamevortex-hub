import { describe, expect, it } from "vitest";
import {
  STORE_CONFLICT_ERRORS,
  isFreeProduct,
  orderSaleProblem,
  ownedGameIds,
  revokeEntitlementsForRefund,
  type SaleCheckItem,
} from "../lib/store-guards";

const item = (over: Partial<SaleCheckItem["product"]> = {}, unitPriceCents = 500): SaleCheckItem => ({
  unitPriceCents,
  product: {
    active: true,
    supplierVerified: true,
    kind: "GAME_KEY",
    deliveryType: "CODE",
    priceCents: 500,
    currency: "USD",
    game: { published: true, sourceStatus: "VERIFIED" },
    ...over,
  },
});

describe("orderSaleProblem", () => {
  it("accepts an order whose items are on sale at the ordered price", () => {
    expect(orderSaleProblem([item()], "USD")).toBeNull();
    expect(orderSaleProblem([item({ game: { published: true, sourceStatus: "OFFICIAL_SOURCE" } })], "usd")).toBeNull();
  });

  it("refuses withdrawn, unverified or unsupported products", () => {
    expect(orderSaleProblem([item({ active: false })], "USD")).toBe("ORDER_ITEM_NOT_AVAILABLE_FOR_SALE");
    expect(orderSaleProblem([item({ supplierVerified: false })], "USD")).toBe("ORDER_ITEM_NOT_AVAILABLE_FOR_SALE");
    expect(orderSaleProblem([item({ kind: "GIFT_CARD" })], "USD")).toBe("ORDER_ITEM_NOT_AVAILABLE_FOR_SALE");
    expect(orderSaleProblem([item({ deliveryType: "MANUAL" })], "USD")).toBe("ORDER_ITEM_NOT_AVAILABLE_FOR_SALE");
    expect(orderSaleProblem([item({ game: { published: false, sourceStatus: "VERIFIED" } })], "USD")).toBe("ORDER_ITEM_NOT_AVAILABLE_FOR_SALE");
    expect(orderSaleProblem([item({ game: { published: true, sourceStatus: "NEEDS_SOURCE" } })], "USD")).toBe("ORDER_ITEM_NOT_AVAILABLE_FOR_SALE");
  });

  it("refuses a stale price or currency (price changed after the order was created)", () => {
    expect(orderSaleProblem([item({ priceCents: 1000 }, 500)], "USD")).toBe("ORDER_PRICE_CHANGED");
    expect(orderSaleProblem([item({ priceCents: 0 }, 500)], "USD")).toBe("ORDER_PRICE_CHANGED");
    expect(orderSaleProblem([item({ currency: "EUR" })], "USD")).toBe("ORDER_PRICE_CHANGED");
  });

  it("checks every item of the order", () => {
    expect(orderSaleProblem([item(), item({ active: false })], "USD")).toBe("ORDER_ITEM_NOT_AVAILABLE_FOR_SALE");
  });
});

describe("store helpers", () => {
  it("knows free products and conflict codes", () => {
    expect(isFreeProduct(0)).toBe(true);
    expect(isFreeProduct(1)).toBe(false);
    expect(STORE_CONFLICT_ERRORS.has("ALREADY_OWNED")).toBe(true);
    expect(STORE_CONFLICT_ERRORS.has("FREE_PRODUCT_ALREADY_CLAIMED")).toBe(true);
    expect(STORE_CONFLICT_ERRORS.has("SOMETHING_ELSE")).toBe(false);
  });

  it("ownedGameIds only reports active entitlements", async () => {
    const client = {
      entitlement: {
        findMany: async (args: { where: { revokedAt: null; gameId: { in: string[] } } }) => {
          expect(args.where.revokedAt).toBeNull();
          return [{ gameId: "g1" }];
        },
      },
    };
    expect([...(await ownedGameIds(client as never, "u1", ["g1", "g2"]))]).toEqual(["g1"]);
    expect((await ownedGameIds(client as never, "u1", [])).size).toBe(0);
  });
});

describe("revokeEntitlementsForRefund", () => {
  function fake(otherItemId: string | null) {
    const calls: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
    const client = {
      orderItem: {
        findMany: async () => [{ product: { gameId: "g1" } }, { product: { gameId: "g1" } }],
        findFirst: async () => (otherItemId ? { id: otherItemId } : null),
      },
      entitlement: {
        updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          calls.push(args);
          return { count: 1 };
        },
      },
    };
    return { client, calls };
  }

  it("revokes access when no other valid purchase exists", async () => {
    const { client, calls } = fake(null);
    await revokeEntitlementsForRefund(client as never, "u1", ["i1", "i2"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].data.revokedAt instanceof Date).toBe(true);
  });

  it("keeps access (moved to the other purchase) when the user bought the game again", async () => {
    const { client, calls } = fake("i9");
    await revokeEntitlementsForRefund(client as never, "u1", ["i1"]);
    expect(calls).toHaveLength(2);
    expect(calls[1].data).toEqual({ revokedAt: null, orderItemId: "i9" });
  });

  it("does nothing without items", async () => {
    const { client, calls } = fake(null);
    await revokeEntitlementsForRefund(client as never, "u1", []);
    expect(calls).toHaveLength(0);
  });
});
