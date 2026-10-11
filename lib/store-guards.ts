import type { Prisma } from "@prisma/client";

/**
 * Store rules shared by order creation, wallet checkout, card checkout and refunds.
 * The pure checks have no database access so they can be unit tested.
 */

export type StoreErrorCode =
  | "ORDER_ITEM_NOT_AVAILABLE_FOR_SALE"
  | "ORDER_PRICE_CHANGED"
  | "ALREADY_OWNED"
  | "FREE_PRODUCT_ALREADY_CLAIMED"
  | "FREE_PRODUCT_QUANTITY_LIMIT";

/** Every store error that means "your request conflicts with the current state" (HTTP 409). */
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
 * An order is created at one moment and paid later. Before money moves, every item must still be
 * on sale (published, verified, supported type) and still cost what the order says, otherwise a
 * stale pending order could be paid at an old price, or for a product that was withdrawn.
 */
export function orderSaleProblem(items: readonly SaleCheckItem[], orderCurrency: string): StoreErrorCode | null {
  for (const item of items) {
    const { product } = item;
    const sellable =
      product.active &&
      product.supplierVerified &&
      product.kind === "GAME_KEY" &&
      product.deliveryType === "CODE" &&
      product.game.published &&
      VERIFIED_GAME_SOURCES.has(product.game.sourceStatus);
    if (!sellable) return "ORDER_ITEM_NOT_AVAILABLE_FOR_SALE";
    if (item.unitPriceCents !== product.priceCents || product.currency.toUpperCase() !== orderCurrency.toUpperCase()) {
      return "ORDER_PRICE_CHANGED";
    }
  }
  return null;
}

/** A free product can be claimed once per user and only one copy at a time. */
export function isFreeProduct(priceCents: number): boolean {
  return priceCents === 0;
}

type EntitlementReader = Pick<Prisma.TransactionClient, "entitlement">;
type OrderItemReader = Pick<Prisma.TransactionClient, "orderItem" | "entitlement">;

/** Games the user already owns (active, not refunded) among the given ones. */
export async function ownedGameIds(client: EntitlementReader, userId: string, gameIds: readonly string[]): Promise<Set<string>> {
  if (!gameIds.length) return new Set();
  const rows = await client.entitlement.findMany({
    where: { userId, gameId: { in: [...gameIds] }, revokedAt: null },
    select: { gameId: true },
  });
  return new Set(rows.map((row) => row.gameId));
}

/**
 * Revokes the access granted by refunded order items. Access is per game (one Entitlement per
 * user and game, pointing at the first purchase), so when the user still has another valid
 * purchase of the same game, access moves to that purchase instead of being lost.
 */
export async function revokeEntitlementsForRefund(
  client: OrderItemReader,
  userId: string,
  refundedItemIds: readonly string[],
): Promise<void> {
  if (!refundedItemIds.length) return;
  const ids = [...refundedItemIds];

  const refunded = await client.orderItem.findMany({
    where: { id: { in: ids } },
    select: { product: { select: { gameId: true } } },
  });
  const gameIds = Array.from(new Set(refunded.map((item) => item.product.gameId)));

  await client.entitlement.updateMany({
    where: { userId, gameId: { in: gameIds }, revokedAt: null, orderItemId: { in: ids } },
    data: { revokedAt: new Date() },
  });

  for (const gameId of gameIds) {
    const other = await client.orderItem.findFirst({
      where: {
        id: { notIn: ids },
        product: { gameId },
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
