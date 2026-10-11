import {
  expireDueVipSubscriptions,
  expireVipSubscription as expireSubscription,
} from "@/lib/vip-subscriptions";

/**
 * Marks an expired VIP subscription as EXPIRED.
 *
 * Access checks do not depend on this running because getVipAccess() also
 * checks expiresAt against the current time. There is a single implementation
 * (in vip-subscriptions) so the event history, notification and conditional
 * status change cannot drift apart; this wrapper only keeps the old boolean
 * contract for existing callers.
 */
export async function expireVipSubscription(
  subscriptionId: string,
): Promise<boolean> {
  const result = await expireSubscription(subscriptionId);
  return result.changed;
}

export { expireDueVipSubscriptions };
