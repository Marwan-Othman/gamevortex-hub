export const OWNER_POINTS_PER_USD = Number(process.env.OWNER_POINTS_PER_USD ?? 30);
export const OWNER_MIN_WITHDRAW_POINTS = Number(process.env.OWNER_MIN_WITHDRAW_POINTS ?? 15);
export function pointsToUsd(points:number){ return points / OWNER_POINTS_PER_USD; }
export function validateOwnerWithdrawal(points:number){
  if (!Number.isInteger(points) || points < OWNER_MIN_WITHDRAW_POINTS) throw new Error('MINIMUM_WITHDRAWAL_NOT_MET');
  return Number(pointsToUsd(points).toFixed(2));
}
