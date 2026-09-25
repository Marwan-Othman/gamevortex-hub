export const dynamic = "force-dynamic";
import Link from 'next/link';
import { db } from '../../lib/prisma';
import { vortexScore } from '../../lib/game-score';

type Props = { searchParams: Promise<{ q?: string; platform?: string; genre?: string; sort?: string }> };

export default async function Games({ searchParams }: Props) {
  const params = await searchParams;
  const q = (params.q || '').trim().slice(0, 80);
  const platform = (params.platform || '').trim().slice(0, 60);
  const genre = (params.genre || '').trim().slice(0, 60);
  const sort = params.sort || 'rating';
  const where = { published: true, ...(platform ? { platform: { equals: platform, mode: 'insensitive' as const } } : {}), ...(genre ? { genre: { equals: genre, mode: 'insensitive' as const } } : {}), ...(q ? { OR: [{ titleAr: { contains: q, mode: 'insensitive' as const } }, { titleEn: { contains: q, mode: 'insensitive' as const } }, { description: { contains: q, mode: 'insensitive' as const } }] } : {}) };
  const orderBy = sort === 'popular' ? [{ playCount: 'desc' as const }, { viewCount: 'desc' as const }] : sort === 'newest' ? [{ createdAt: 'desc' as const }] : [{ featured: 'desc' as const }, { ratingAverage: 'desc' as const }, { ratingCount: 'desc' as const }];
  const [games, platforms, genres] = await Promise.all([
    db.game.findMany({ where, orderBy, take: 60 }),
    db.game.findMany({ where: { published: true }, select: { platform: true }, distinct: ['platform'], orderBy: { platform: 'asc' } }),
    db.game.findMany({ where: { published: true }, select: { genre: true }, distinct: ['genre'], orderBy: { genre: 'asc' } })
  ]);
  const clean = (values: { platform?: string | null; genre?: string | null }[], key: 'platform' | 'genre') => [...new Set(values.map(v => v[key]).filter((v): v is string => Boolean(v)))];
  const platformValues = clean(platforms, 'platform');
  const genreValues = clean(genres, 'genre');
  return <main className="wrap"><section className="glass hero"><p className="muted">GAME DISCOVERY</p><h1>اكتشف عالم الألعاب</h1><p>بحث وفلترة وترتيب من الخادم مع Vortex Score لاكتشاف الألعاب الأبرز.</p>
    <form className="glass card filters" method="get"><input className="input" name="q" defaultValue={q} maxLength={80} placeholder="ابحث باسم اللعبة..." aria-label="بحث عن لعبة" />
      <div className="filter-row"><select className="input" name="platform" defaultValue={platform} aria-label="المنصة"><option value="">كل المنصات</option>{platformValues.map(v => <option key={v} value={v}>{v}</option>)}</select><select className="input" name="genre" defaultValue={genre} aria-label="النوع"><option value="">كل الأنواع</option>{genreValues.map(v => <option key={v} value={v}>{v}</option>)}</select><select className="input" name="sort" defaultValue={sort} aria-label="الترتيب"><option value="rating">الأعلى تقييمًا</option><option value="popular">الأكثر لعبًا</option><option value="newest">الأحدث</option></select><button className="btn" type="submit">بحث</button></div>
    </form></section><div className="grid">{games.map(g => <Link href={`/games/${g.slug}`} key={g.id} className="glass card game-card">{g.coverUrl && <img className="cover" src={g.coverUrl} alt={g.titleEn} loading="lazy" />}<div className="card-top"><span className="badge">VORTEX {vortexScore(g)}</span><span className="muted">★ {g.ratingAverage.toFixed(1)}</span></div><h2>{g.titleAr}</h2><p>{g.titleEn}</p><p className="muted">{g.platform || 'Multi-platform'} · {g.genre || 'Gaming'} · {g.playCount} لعب</p></Link>)}</div>{!games.length && <section className="glass card"><h2>لا توجد نتائج</h2><p className="muted">جرّب تغيير البحث أو الفلاتر.</p></section>}</main>;
}
