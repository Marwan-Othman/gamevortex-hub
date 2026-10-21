import type { Prisma } from "@prisma/client";

/**
 * Shared store rules for order creation, wallet checkout, card checkout, and refunds.
 * Kept database-free where possible so policy can be covered by unit tests.
 */

export type StoreErrorCode =
  | "ORDER_ITEM_NOT_AVAILABLE_FOR_SALE"
  | "ORDER_PRICE_CHANGED"
  | "ALREADY_OWNED"
  | "FREE_PRODUCT_ALREADY_CLAIMED"
  | "FREE_PRODUCT_QUANTITY_LIMIT";

export const STORE_CONFLICT_ERRORS: ReadonlySet<string> = new Set<StoreErrorCode>([
  "ORDER_ITEM_NOT_AVAILABLE_FOR_SALE",
  "ORDER_PRICE_CHANGED",
  "ALREADY_OWNED",
  "FREE_PRODUCT_ALREADY_CLAIMED",
]);

export type SaleCheckItem = {
  unitPriceCents: number;
  product: {
    active: boolean;
    supplierVerified: boolean;
    kind: string;
    deliveryType: string;
    priceCents: number;
    currency: string;
    game: { published: boolean; sourceStatus: string };
  };
};

const VERIFIED_GAME_SOURCES = new Set(["VERIFIED", "OFFICIAL_SOURCE"]);

/**
 * GAME_KEY and GIFT_CARD are supported one-time CODE products. A gift card's related
 * game record is its verified catalog/brand record; it is never a game entitlement.
 */
export function orderSaleProblem(items: readonly SaleCheckItem[], orderCurrency: string): StoreErrorCode | null {
  for (const item of items) {
    const { product } = item;
    const sellable =
      product.active &&
      product.supplierVerified &&
      (product.kind === "GAME_KEY" || product.kind === "GIFT_CARD") &&
      product.deliveryType === "CODE" &&
      product.game.published &&
      VERIFIED_GAME_SOURCES.has(product.game.sourceStatus);
    if (!sellable) return "ORDER_ITEM_NOT_AVAILABLE_FOR_SALE";
    if (
      item.unitPriceCents !== product.priceCents ||
      product.currency.toUpperCase() !== orderCurrency.toUpperCase()
    ) {
      return "ORDER_PRICE_CHANGED";
    }
  }
  return null;
}

export function isFreeProduct(priceCents: number): boolean {
  return priceCents === 0;
}

type EntitlementReader = Pick<Prisma.TransactionClient, "entitlement">;
type OrderItemReader = Pick<Prisma.TransactionClient, "orderItem" | "entitlement">;

export async function ownedGameIds(client: EntitlementReader, userId: string, gameIds: readonly string[]): Promise<Set<string>> {
  if (!gameIds.length) return new Set();
  const rows = await client.entitlement.findMany({
    where: { userId, gameId: { in: [...gameIds] }, revokedAt: null },
    select: { gameId: true },
  });
  return new Set(rows.map((row) => row.gameId));
}

/**
 * Refunded GAME_KEY orders revoke game access. GIFT_CARD rows are excluded even though they
 * reference a catalog game for brand/region grouping.
 */
export async function revokeEntitlementsForRefund(
  client: OrderItemReader,
  userId: string,
  refundedItemIds: readonly string[],
): Promise<void> {
  if (!refundedItemIds.length) return;
  const ids = [...refundedItemIds];
  const refunded = await client.orderItem.findMany({
    where: { id: { in: ids }, product: { kind: "GAME_KEY" } },
    select: { id: true, product: { select: { gameId: true } } },
  });
  const gameItemIds = refunded.map((item) => item.id);
  const gameIds = Array.from(new Set(refunded.map((item) => item.product.gameId)));
  if (!gameItemIds.length) return;

  await client.entitlement.updateMany({
    where: { userId, gameId: { in: gameIds }, revokedAt: null, orderItemId: { in: gameItemIds } },
    data: { revokedAt: new Date() },
  });

  for (const gameId of gameIds) {
    const other = await client.orderItem.findFirst({
      where: {
        id: { notIn: ids },
        product: { kind: "GAME_KEY", gameId },
        order: { userId, status: "COMPLETED", paymentStatus: { in: ["SUCCEEDED", "NOT_REQUIRED"] } },
      },
      orderBy: { order: { createdAt: "asc" } },
      select: { id: true },
    });
    if (other) {
      await client.entitlement.updateMany({
        where: { userId, gameId },
        data: { revokedAt: null, orderItemId: other.id },
      });
    }
  }
}
