import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getOrCreateGamerProfile, xpForLevel } from "@/lib/gamer";
import { prisma } from "@/lib/prisma";
import { guardMutation, guardRead, userRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Profile images must be plain https URLs (no javascript:/data: schemes, no credentials). */
function safeImageUrl(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 500) throw new Error("INVALID_PROFILE_URL");
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("INVALID_PROFILE_URL");
    return url.toString();
  } catch {
    throw new Error("INVALID_PROFILE_URL");
  }
}

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "gamer-profile:read", 60);
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const profile = await getOrCreateGamerProfile(user.id);
    const achievements = await prisma.userAchievement.findMany({
      where: { profileId: profile.id },
      include: { achievement: true },
      orderBy: { unlockedAt: "desc" },
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
        xpNeeded: Math.max(0, nextLevelXp - profile.xp),
      },
    });
  } catch (error) {
    return userRouteError(error, "PROFILE_LOAD_FAILED");
  }
}

export async function PATCH(req: NextRequest) {
  const blocked = await guardMutation(req, "gamer-profile", 20);
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("INVALID_BODY_SHAPE");
    const data = {
      displayName: typeof body.displayName === "string" ? body.displayName.trim().slice(0, 40) : undefined,
      bio: typeof body.bio === "string" ? body.bio.trim().slice(0, 500) : undefined,
      avatarUrl: safeImageUrl(body.avatarUrl),
      bannerUrl: safeImageUrl(body.bannerUrl),
      favoritePlatform: typeof body.favoritePlatform === "string" ? body.favoritePlatform.trim().slice(0, 40) : undefined,
    };
    const profile = await prisma.gamerProfile.upsert({
      where: { userId: user.id },
      update: data,
      create: { userId: user.id, ...data },
    });
    return NextResponse.json({ profile });
  } catch (error) {
    if (error instanceof Error && (error.message === "INVALID_PROFILE_URL" || error.message === "INVALID_BODY_SHAPE")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return userRouteError(error, "PROFILE_UPDATE_FAILED");
  }
}
