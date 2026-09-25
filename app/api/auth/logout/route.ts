import { NextRequest, NextResponse } from 'next/server';
import { destroySession } from '../../../../lib/auth';
import { guardMutation } from '../../../../lib/api';

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, 'auth:logout', 20);
  if (blocked) return blocked;
  await destroySession();
  return NextResponse.json({ ok: true });
}
