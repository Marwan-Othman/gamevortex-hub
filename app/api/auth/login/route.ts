import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../lib/prisma';
import { createSession, verifyPassword } from '../../../../lib/auth';
import { guardMutation } from '../../../../lib/api';
import { grantXp } from '../../../../lib/gamer';

const schema = z.object({ email: z.string().trim().email().max(320), password: z.string().min(1).max(200) });

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, 'auth:login', 8);
  if (blocked) return blocked;
  try {
    const body = schema.parse(await request.json());
    const user = await db.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (!user?.passwordHash || !verifyPassword(body.password, user.passwordHash)) {
      return NextResponse.json({ error: 'INVALID_CREDENTIALS' }, { status: 401 });
    }
    await createSession(user.id);
    try { const firstLogin = await db.xpEvent.findFirst({ where: { profile: { userId: user.id }, reason: 'FIRST_LOGIN' } }); if (!firstLogin) await grantXp(user.id, 50, 'FIRST_LOGIN'); } catch {}
    return NextResponse.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'INVALID_INPUT' }, { status: 400 });
    return NextResponse.json({ error: 'LOGIN_FAILED' }, { status: 400 });
  }
}
