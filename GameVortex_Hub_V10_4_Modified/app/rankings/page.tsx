import Link from "next/link";
import { db } from "../../lib/prisma";

export const dynamic = "force-dynamic";

export default async function RankingsPage() {
  const players = await db.gamerProfile.findMany({
    orderBy: [{ level: "desc" }, { xp: "desc" }, { totalPlayMinutes: "desc" }],
    take: 50,
    include: { user: { select: { username: true } } }
  });

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <span className="badge">VORTEX RANKINGS</span>
        <h1>ترتيب اللاعبين</h1>
        <p>أفضل لاعبي GameVortex حسب المستوى والخبرة ووقت اللعب.</p>
      </section>
      <section className="grid">
        {players.map((player, index) => (
          <Link key={player.id} href={player.user.username ? `/gamer/${player.user.username}` : "/profile/gamer"} className="glass card">
            <span className="badge">#{index + 1} · LVL {player.level}</span>
            <h2>{player.displayName || player.user.username || "Gamer"}</h2>
            <p className="muted">{player.xp.toLocaleString()} XP · {player.totalPlayMinutes.toLocaleString()} دقيقة لعب</p>
          </Link>
        ))}
        {!players.length && <div className="glass card"><p className="muted">لا توجد ملفات لاعبين في الترتيب بعد.</p></div>}
      </section>
    </main>
  );
}
