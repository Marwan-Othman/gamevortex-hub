import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getOrCreateGamerProfile, xpForLevel } from "@/lib/gamer";
import { prisma } from "@/lib/prisma";
import { guardMutation } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireUser();
    const profile = await getOrCreateGamerProfile(user.id);
    const achievements = await prisma.userAchievement.findMany({
      where: { profileId: profile.id },
      include: { achievement: true },
      orderBy: { unlockedAt: "desc" }
    });
    const nextLevelXp = xpForLevel(profile.level + 1);
    const currentLevelXp = xpForLevel(profile.level);

    return NextResponse.json({
      profile,
      achievements,
      progress: {
        currentLevelXp,
        nextLevelXp,
        xpIntoLevel: Math.max(0, profile.xp - currentLevelXp),
        xpNeeded: Math.max(0, nextLevelXp - profile.xp)
      }
    });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function PATCH(req: NextRequest) {
  const blocked = await guardMutation(req, "gamer-profile", 20); if (blocked) return blocked;
  try {
    const user = await requireUser();
    const body = await req.json();
    const data = {
      displayName: typeof body.displayName === "string" ? body.displayName.slice(0, 40) : undefined,
      bio: typeof body.bio === "string" ? body.bio.slice(0, 500) : undefined,
      avatarUrl: typeof body.avatarUrl === "string" ? body.avatarUrl.slice(0, 500) : undefined,
      bannerUrl: typeof body.bannerUrl === "string" ? body.bannerUrl.slice(0, 500) : undefined,
      favoritePlatform: typeof body.favoritePlatform === "string" ? body.favoritePlatform.slice(0, 40) : undefined
    };
    const profile = await prisma.gamerProfile.upsert({
      where: { userId: user.id },
      update: data,
      create: { userId: user.id, ...data }
    });
    return NextResponse.json({ profile });
  } catch {
    return NextResponse.json({ error: "Unable to update profile" }, { status: 400 });
  }
}
