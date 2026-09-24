import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../lib/prisma';
import { guardRead } from '../../../../lib/api';

export async function GET(req: NextRequest) {
  const blocked = await guardRead(req, 'quran:audio', 60);
  if (blocked) return blocked;
  const id = req.nextUrl.searchParams.get('reciterId');
  if (!id) return NextResponse.json({ error: 'reciterId required' }, { status: 400 });
  const r = await db.quranReciter.findFirst({
    where: { id, active: true, sourceVerificationStatus: 'VERIFIED' },
  });
  if (!r) return NextResponse.json({ error: 'SOURCE_NOT_VERIFIED' }, { status: 404 });
  return NextResponse.json({ baseUrl: r.audioBaseUrl, provider: r.provider, legalSourceUrl: r.legalSourceUrl });
}
