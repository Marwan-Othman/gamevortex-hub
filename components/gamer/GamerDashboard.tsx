"use client";

import { useEffect, useState } from "react";

type Data = {
  profile: {
    displayName?: string | null;
    bio?: string | null;
    favoritePlatform?: string | null;
    level: number;
    xp: number;
    totalPlayMinutes: number;
  };
  achievements: Array<{ id: string; unlockedAt: string; achievement: {
    name: string; description: string; icon?: string | null; rarity: string; xpReward: number;
  }}>;
  progress: { currentLevelXp: number; nextLevelXp: number; xpIntoLevel: number; xpNeeded: number };
};

export default function GamerDashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [library, setLibrary] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);

  useEffect(() => {
    fetch("/api/me/gamer-profile").then(async r => {
      if (!r.ok) throw new Error("Login required");
      setData(await r.json());
      const [lib, notes] = await Promise.all([fetch('/api/me/games/library').then(x => x.ok ? x.json() : []), fetch('/api/me/notifications').then(x => x.ok ? x.json() : [])]);
      setLibrary(lib); setNotifications(notes);
    }).catch(e => setError(e.message));
  }, []);

  if (error) return <main className="mx-auto max-w-4xl p-6"><h1 className="text-3xl font-bold">Gamer Profile</h1><p className="mt-3">{error}</p></main>;
  if (!data) return <main className="mx-auto max-w-4xl p-6">Loading your Gamer Profile…</main>;

  const pct = Math.min(100, Math.max(0, (data.progress.xpIntoLevel / Math.max(1, data.progress.nextLevelXp - data.progress.currentLevelXp)) * 100));
  const hours = Math.floor(data.profile.totalPlayMinutes / 60);

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <section className="rounded-3xl border p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm opacity-70">GAMEVORTEX GAMER</p>
            <h1 className="text-4xl font-black">{data.profile.displayName || "Gamer"}</h1>
            <p className="mt-2 opacity-75">{data.profile.bio || "Build your gaming identity."}</p>
          </div>
          <div className="text-right">
            <div className="text-5xl font-black">LVL {data.profile.level}</div>
            <div className="text-sm opacity-70">{data.profile.xp.toLocaleString()} XP</div>
          </div>
        </div>
        <div className="mt-6">
          <div className="mb-2 flex justify-between text-sm"><span>Vortex Progress</span><span>{data.progress.xpNeeded.toLocaleString()} XP to next level</span></div>
          <div className="h-3 overflow-hidden rounded-full bg-black/10"><div className="h-full rounded-full bg-current transition-all" style={{width: `${pct}%`}} /></div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Stat label="Favorite Platform" value={data.profile.favoritePlatform || "Not set"} />
        <Stat label="Gaming Time" value={`${hours.toLocaleString()}h`} />
        <Stat label="Achievements" value={String(data.achievements.length)} />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-3xl border p-6"><h2 className="text-2xl font-bold">📚 Library</h2><p className="mt-2 text-3xl font-black">{library.length}</p><p className="opacity-60">games tracked</p></div>
        <div className="rounded-3xl border p-6"><h2 className="text-2xl font-bold">🔔 Notifications</h2><p className="mt-2 text-3xl font-black">{notifications.filter(n => !n.readAt).length}</p><p className="opacity-60">unread</p></div>
      </section>

      <section className="rounded-3xl border p-6">
        <div className="mb-4 flex items-center justify-between"><h2 className="text-2xl font-bold">Achievements</h2><span className="text-sm opacity-60">{data.achievements.length} unlocked</span></div>
        {data.achievements.length === 0 ? <p className="opacity-70">Your first achievement is waiting. Start exploring GameVortex.</p> :
          <div className="grid gap-3 sm:grid-cols-2">{data.achievements.map(({id, achievement}) =>
            <article key={id} className="rounded-2xl border p-4">
              <div className="text-3xl">{achievement.icon || "🏆"}</div>
              <h3 className="mt-2 font-bold">{achievement.name}</h3>
              <p className="text-sm opacity-70">{achievement.description}</p>
              <p className="mt-2 text-xs uppercase opacity-60">{achievement.rarity} · +{achievement.xpReward} XP</p>
            </article>
          )}</div>}
      </section>
    </main>
  );
}

function Stat({label, value}: {label: string; value: string}) {
  return <div className="rounded-2xl border p-5"><p className="text-xs uppercase opacity-60">{label}</p><p className="mt-2 text-xl font-bold">{value}</p></div>;
}
