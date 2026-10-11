import Link from "next/link";
import { unstable_cache } from "next/cache";
import { db } from "../../lib/prisma";

export const dynamic = "force-dynamic";

// Leaderboard is public and identical for everyone: one query per minute instead of one per visit,
// and only the columns that are rendered.
const getTopPlayers = unstable_cache(
  async () =>
    db.gamerProfile.findMany({
      orderBy: [{ level: "desc" }, { xp: "desc" }, { totalPlayMinutes: "desc" }],
      take: 50,
      select: {
        id: true,
        displayName: true,
        level: true,
        xp: true,
        totalPlayMinutes: true,
        user: { select: { username: true } },
      },
    }),
  ["rankings-top-players-v1"],
  { revalidate: 60, tags: ["rankings"] },
);

export default async function RankingsPage() {
  const players = await getTopPlayers();

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
