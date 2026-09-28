import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { createSession, hashPassword } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { Prisma } from "@prisma/client";
import { generateUniqueReferralCode, linkReferral } from "@/lib/referrals";

const schema = z.object({
  email: z.string().trim().email().max(320),
  username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_]+$/),
  password: z.string().min(10).max(200),
  referralCode: z.string().trim().max(40).optional(),
});

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "auth:register", 5);
  if (blocked) return blocked;
  try {
    const body = schema.parse(await request.json());
    const email = body.email.toLowerCase();
    const username = body.username.toLowerCase();
    const existing = await db.user.findFirst({ where: { OR: [{ email }, { username }] }, select: { id: true } });
    if (existing) return NextResponse.json({ error: "ACCOUNT_ALREADY_EXISTS" }, { status: 409 });
    const referralCode = await generateUniqueReferralCode(username);
    const user = await db.user.create({
      data: { email, username, passwordHash: hashPassword(body.password), referralCode, wallet: { create: {} } },
      select: { id: true, email: true, username: true, role: true, points: true, referralCode: true },
    });
    const referral = await linkReferral(user.id, body.referralCode);
    await createSession(user.id);
    return NextResponse.json({ ok: true, user, referralApplied: Boolean(referral) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
    // Unique constraints are the final race-safe guard after the pre-check above.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "ACCOUNT_ALREADY_EXISTS" }, { status: 409 });
    }
    return NextResponse.json({ error: "REGISTER_FAILED" }, { status: 400 });
  }
}
