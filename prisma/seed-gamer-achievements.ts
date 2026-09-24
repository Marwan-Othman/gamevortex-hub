import { PrismaClient, AchievementRarity } from "@prisma/client";

const prisma = new PrismaClient();

const achievements = [
  { key: "FIRST_LOGIN", name: "First Login", description: "Welcome to GameVortex.", rarity: AchievementRarity.COMMON, xpReward: 50, icon: "👋" },
  { key: "FIRST_FAVORITE", name: "Game Hunter", description: "Add your first game to favorites.", rarity: AchievementRarity.COMMON, xpReward: 75, icon: "❤️" },
  { key: "FIRST_REVIEW", name: "Critic", description: "Write your first game review.", rarity: AchievementRarity.COMMON, xpReward: 100, icon: "✍️" },
  { key: "TEN_GAMES", name: "Collector", description: "Reach ten games in your library.", rarity: AchievementRarity.RARE, xpReward: 250, icon: "🎮" },
  { key: "LEVEL_10", name: "Vortex Rising", description: "Reach level 10.", rarity: AchievementRarity.EPIC, xpReward: 500, icon: "⚡" },
  { key: "LEVEL_25", name: "Vortex Elite", description: "Reach level 25.", rarity: AchievementRarity.LEGENDARY, xpReward: 1000, icon: "👑" }
];

async function main() {
  for (const achievement of achievements) {
    await prisma.achievement.upsert({
      where: { key: achievement.key },
      update: achievement,
      create: achievement
    });
  }
}

main().finally(() => prisma.$disconnect());
