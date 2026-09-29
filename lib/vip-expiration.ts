import {
  VipSubscriptionEventType,
} from "@prisma/client";

import { db } from "@/lib/prisma";

/**
 * Marks an expired VIP subscription as EXPIRED.
 *
 * Access checks do not depend on this function running because
 * getVipAccess() also checks expiresAt against the current time.
 */
export async function expireVipSubscription(
  subscriptionId: string,
) {
  const now =
    new Date();

  return db.$transaction(
    async (tx) => {
      const subscription =
        await tx.vipSubscription.findUnique({
          where: {
            id:
              subscriptionId,
          },
          select: {
            id:
              true,
            status:
              true,
            expiresAt:
              true,
          },
        });

      if (!subscription) {
        throw new Error(
          "VIP_SUBSCRIPTION_NOT_FOUND",
        );
      }

      if (
        subscription.status !==
          "ACTIVE" ||
        !subscription.expiresAt ||
        subscription.expiresAt >
          now
      ) {
        return false;
      }

      await tx.vipSubscription.update({
        where: {
          id:
            subscription.id,
        },
        data: {
          status:
            "EXPIRED",
        },
      });

      await tx.vipSubscriptionEvent.create({
        data: {
          subscriptionId:
            subscription.id,
          type:
            VipSubscriptionEventType.EXPIRED,
          metadata: {
            expiredAt:
              now.toISOString(),
          },
        },
      });

      return true;
    },
  );
}
