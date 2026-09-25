export const dynamic = "force-dynamic";
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { db } from '../../../lib/prisma';
import { vortexScore } from '../../../lib/game-score';
import GameActions from '@/components/games/GameActions';
import ReviewForm from '@/components/games/ReviewForm';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const game = await db.game.findFirst({ where: { slug, published: true }, select: { titleAr:true, titleEn:true, description:true, coverUrl:true, slug:true } });
  if (!game) return { title:"اللعبة غير موجودة | GameVortex" };
  const title = `${game.titleAr} | GameVortex Hub`;
  const description = (game.description || `اكتشف ${game.titleEn} على GameVortex Hub.`).slice(0,160);
  const base = process.env.APP_ORIGIN || "http://localhost:3000";
  return { title, description, alternates:{ canonical:`${base}/games/${game.slug}` }, openGraph:{ title, description, url:`${base}/games/${game.slug}`, type:"website", images:game.coverUrl ? [{url:game.coverUrl}] : [] } };
}

export default async function GameDetails({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = await db.game.findFirst({ where: { slug, published: true }, include: { reviews: { orderBy: { createdAt: 'desc' }, take: 8, include: { user: { select: { username: true } } } } } });
  if (!game) notFound();
  const score = vortexScore(game);
  return <main className="wrap">
    <Link href="/games" className="muted">← العودة للألعاب</Link>
    <section className="glass hero game-detail">
      {game.coverUrl && <img className="detail-cover" src={game.coverUrl} alt={game.titleEn} />}
      <div><span className="badge">VORTEX SCORE {score}</span><h1>{game.titleAr}</h1><p className="muted">{game.titleEn}</p><p>{game.description || 'لا يوجد وصف بعد.'}</p><div className="stat-row"><span>{game.platform || 'منصات متعددة'}</span><span>{game.genre || 'ألعاب'}</span><span>★ {game.ratingAverage.toFixed(1)} ({game.ratingCount})</span><span>👁 {game.viewCount}</span></div>{game.officialUrl && <a className="btn" href={game.officialUrl} target="_blank" rel="noreferrer">الموقع الرسمي</a>}</div>
    </section>
    <GameActions gameId={game.id} />
    <ReviewForm slug={slug} />
    <section><h2>آخر المراجعات</h2><div className="grid">{game.reviews.length ? game.reviews.map(r => <article className="glass card" key={r.id}><strong>{r.user.username || 'Gamer'}</strong><p>★ {r.rating}/5</p><p className="muted">{r.text || 'بدون تعليق'}</p></article>) : <p className="muted">لا توجد مراجعات بعد.</p>}</div></section>
  </main>;
}
