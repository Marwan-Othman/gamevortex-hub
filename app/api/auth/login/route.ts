import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../lib/prisma';
import { createSession, hashPassword, verifyPassword } from '../../../../lib/auth';
import { guardMutation, logRouteError, userRouteError } from '../../../../lib/api';
import { grantXp } from '../../../../lib/gamer';
import { rateLimitAsync } from '../../../../lib/security';

const schema = z.object({ email: z.string().trim().email().max(320), password: z.string().min(1).max(200) });

// Used when the email does not exist, so unknown and known accounts take the same time to reject.
const DUMMY_HASH = hashPassword('timing-equalizer-not-a-real-password');

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, 'auth:login', 8);
  if (blocked) return blocked;
  try {
    const body = schema.parse(await request.json());
    const email = body.email.toLowerCase();

    // Per-account limit: the per-IP guard above does not stop distributed guessing against one account.
    const accountLimit = await rateLimitAsync(`auth:login:account:${email}`, 10, 15 * 60_000);
    if (!accountLimit.allowed) {
      return NextResponse.json({ error: 'RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': String(accountLimit.retryAfter) } });
    }

    const user = await db.user.findUnique({ where: { email } });
    const passwordOk = verifyPassword(body.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user?.passwordHash || !passwordOk) {
      return NextResponse.json({ error: 'INVALID_CREDENTIALS' }, { status: 401 });
    }
    await createSession(user.id);
    try {
      const firstLogin = await db.xpEvent.findFirst({ where: { profile: { userId: user.id }, reason: 'FIRST_LOGIN' } });
      if (!firstLogin) await grantXp(user.id, 50, 'FIRST_LOGIN');
    } catch (xpError) {
      // The login itself succeeded; a failed welcome-XP grant must not block it, but it must be visible in the logs.
      logRouteError('auth:login:first-login-xp', xpError);
    }
    return NextResponse.json({ ok: true, user: { id: user.id, username: user.username, role: user.role } });
  } catch (error) {
    // Validation / malformed body -> 400, database or other unexpected failure -> 503/500 + server log.
    return userRouteError(error, 'LOGIN_FAILED', 'auth:login');
  }
}
