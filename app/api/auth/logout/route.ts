import { NextRequest, NextResponse } from 'next/server';
import { destroySession, getOptionalUser, revokeSessions } from '../../../../lib/auth';
import { guardMutation, logRouteError } from '../../../../lib/api';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, 'auth:logout', 20);
  if (blocked) return blocked;
  try {
    const user = await getOptionalUser();
    // Invalidate the signed cookie server-side too, not only in this browser.
    if (user) await revokeSessions(user.id);
  } catch (error) {
    // The cookie is still destroyed below, so the user is signed out in this browser; the failed server-side revoke is logged.
    logRouteError('auth:logout:revoke', error);
  }
  await destroySession();
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
