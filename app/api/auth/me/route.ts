import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth';
import { guardRead, internalError } from '../../../../lib/api';

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, 'auth:me', 60);
  if (blocked) return blocked;
  try {
    const u = await requireUser();
    return NextResponse.json(
      { id: u.id, email: u.email, username: u.username, role: u.role, points: u.points },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    // Only "not signed in" is a 401. A database/session failure must NOT look like a logout:
    // it answers 500/503 so the client keeps the user's state and can retry.
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    return internalError('auth:me', error, 'AUTH_CHECK_FAILED');
  }
}
