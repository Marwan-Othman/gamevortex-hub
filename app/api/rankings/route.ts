import { NextRequest, NextResponse } from 'next/server';
import { getRankings } from '../../../lib/rankings';
import { guardRead } from '../../../lib/api';
import { toPublicContent } from '../../../lib/downloads';

const CATEGORIES = new Set(['top-rated', 'most-played', 'rising', 'featured']);

export async function GET(req: NextRequest) {
  const blocked = await guardRead(req, 'rankings', 60);
  if (blocked) return blocked;
  const sp = req.nextUrl.searchParams;
  const requested = sp.get('category') ?? 'top-rated';
  const category = CATEGORIES.has(requested) ? requested : 'featured';
  const parsedLimit = Math.floor(Number(sp.get('limit') ?? 12));
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 12;
  try {
    return NextResponse.json((await getRankings(category, limit)).map(toPublicContent), {
      headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' },
    });
  } catch (error) {
    console.error('GET /api/rankings', error);
    return NextResponse.json({ error: 'RANKINGS_FAILED' }, { status: 500 });
  }
}
