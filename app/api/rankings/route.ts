import { NextRequest, NextResponse } from 'next/server';
import { getRankings } from '../../../lib/rankings';
import { guardRead } from '../../../lib/api';

export async function GET(req: NextRequest) {
  const blocked = await guardRead(req, 'rankings', 60);
  if (blocked) return blocked;
  const sp = req.nextUrl.searchParams;
  const category = sp.get('category') ?? 'top-rated';
  const limit = Number(sp.get('limit') ?? 12);
  return NextResponse.json(await getRankings(category, limit), {
    headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' },
  });
}
