import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '../../../../lib/auth';
import { guardRead } from '../../../../lib/api';

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, 'auth:me', 60);
  if (blocked) return blocked;
  try {
    const u = await requireUser();
    return NextResponse.json({ id: u.id, email: u.email, username: u.username, role: u.role, points: u.points });
  } catch {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }
}
