export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/prisma";

export default async function PublicGamer({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const user = await db.user.findUnique({ where: { username }, select: { username:true, createdAt:true, gamerProfile:true, _count:{select:{followers:true,following:true,library:true,reviews:true}} } });
  if (!user) notFound();
  const achievements = user.gamerProfile ? await db.userAchievement.findMany({ where:{profileId:user.gamerProfile.id}, include:{achievement:true}, orderBy:{unlockedAt:"desc"}, take:12 }) : [];
  return <main className="wrap"><section className="glass hero"><div><p className="muted">GAMEVORTEX GAMER PASSPORT</p><h1>{user.gamerProfile?.displayName || `@${user.username}`}</h1><p>{user.gamerProfile?.bio || "A GameVortex gamer."}</p><div className="tabs"><Link className="btn" href="/profile/gamer">إدارة ملفي</Link><span className="badge">LVL {user.gamerProfile?.level || 1}</span></div></div><div className="orb">🎮</div></section><section className="stats"><div className="glass card"><strong>{user.gamerProfile?.xp || 0}</strong><span>XP</span></div><div className="glass card"><strong>{user._count.followers}</strong><span>متابع</span></div><div className="glass card"><strong>{user._count.library}</strong><span>لعبة في المكتبة</span></div><div className="glass card"><strong>{user._count.reviews}</strong><span>مراجعة</span></div></section><section className="glass card"><h2>🏆 الإنجازات</h2><div className="grid">{achievements.map(a=><article className="glass card" key={a.id}><div style={{fontSize:32}}>{a.achievement.icon||"🏆"}</div><h3>{a.achievement.name}</h3><p className="muted">{a.achievement.description}</p></article>)}{achievements.length===0&&<p className="muted">لا توجد إنجازات بعد.</p>}</div></section></main>;
}
