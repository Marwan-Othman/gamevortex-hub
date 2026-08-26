import { prisma } from "@/lib/prisma";

export function xpForLevel(level: number) { return 100 * level * level; }
export function levelFromXp(xp: number) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return level;
}

export const XP_REWARDS = {
  FAVORITED_GAME: 25,
  WISHLISTED_GAME: 15,
  REVIEWED_GAME: 100,
  ADDED_TO_LIBRARY: 20,
  COMPLETED_GAME: 200,
} as const;

export async function getOrCreateGamerProfile(userId: string) {
  return prisma.gamerProfile.upsert({ where: { userId }, update: {}, create: { userId } });
}

async function unlockMilestones(tx: any, userId: string, profileId: string, level: number, xp: number) {
  const keys: string[] = [];
  const [favorites, reviews, library] = await Promise.all([
    tx.favoriteGame.count({ where: { userId } }),
    tx.review.count({ where: { userId } }),
    tx.gameLibraryItem.count({ where: { userId } })
  ]);
  if (xp >= 50) keys.push("FIRST_LOGIN");
  if (favorites >= 1) keys.push("FIRST_FAVORITE");
  if (reviews >= 1) keys.push("FIRST_REVIEW");
  if (library >= 10) keys.push("TEN_GAMES");
  if (level >= 10) keys.push("LEVEL_10");
  if (level >= 25) keys.push("LEVEL_25");
  if (!keys.length) return [];
  const achievements = await tx.achievement.findMany({ where: { key: { in: keys } } });
  const unlocked: any[] = [];
  for (const achievement of achievements) {
    const existing = await tx.userAchievement.findUnique({ where: { profileId_achievementId: { profileId, achievementId: achievement.id } } });
    if (existing) continue;
    const result = await tx.userAchievement.create({ data: { profileId, achievementId: achievement.id } });
    unlocked.push({ ...result, achievement });
    await tx.activity.create({ data: { userId, type: "ACHIEVEMENT_UNLOCKED", message: `Unlocked ${achievement.name}`, metadata: { achievementKey: achievement.key } } });
    await tx.notification.create({ data: { userId, type: "ACHIEVEMENT_UNLOCKED", title: `Achievement unlocked: ${achievement.name}`, body: achievement.description, metadata: { achievementId: achievement.id } } });
  }
  return unlocked;
}

export async function grantXp(userId: string, amount: number, reason: string, sourceId?: string) {
  if (!Number.isInteger(amount) || amount <= 0 || amount > 250) throw new Error("INVALID_XP_AMOUNT");
  const profile = await getOrCreateGamerProfile(userId);
  const oldLevel = profile.level;
  const xp = profile.xp + amount;
  const level = levelFromXp(xp);

  return prisma.$transaction(async (tx) => {
    await tx.xpEvent.create({ data: { profileId: profile.id, amount, reason, sourceId } });
    const updated = await tx.gamerProfile.update({ where: { id: profile.id }, data: { xp, level } });
    const unlocked = await unlockMilestones(tx, userId, profile.id, level, xp);
    if (level > oldLevel) {
      await tx.activity.create({ data: { userId, type: "LEVEL_UP", message: `Reached level ${level}`, metadata: { level } } });
      await tx.notification.create({ data: { userId, type: "LEVEL_UP", title: `Level ${level} unlocked`, body: `You reached level ${level} in GameVortex.`, metadata: { level } } });
    }
    return { profile: updated, unlocked, leveledUp: level > oldLevel };
  });
}

export async function awardActionXp(userId: string, type: keyof typeof XP_REWARDS, gameId?: string) {
  const existing = await prisma.xpEvent.findFirst({ where: { profile: { userId }, reason: type, ...(gameId ? { sourceId: gameId } : {}) } });
  if (existing) return null;
  const result = await grantXp(userId, XP_REWARDS[type], type, gameId);
  return result;
}

export async function createActivity(userId: string, type: any, gameId?: string, message?: string, metadata?: any) {
  return prisma.activity.create({ data: { userId, type, gameId, message, metadata } });
}
