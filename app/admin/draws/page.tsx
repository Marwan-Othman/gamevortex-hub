import Link from "next/link";
import { db } from "@/lib/prisma";
import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import CreateDrawForm from "@/components/draws/CreateDrawForm";
import DrawActions from "@/components/draws/DrawActions";

export const dynamic = "force-dynamic";

export default async function AdminDraws() {
  const gate = await getOwnerOrAccessScreen();
  if ("screen" in gate) return gate.screen;
  const raffles = await db.raffle.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { _count: { select: { entries: true } }, winner: { select: { username: true } } },
  });

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <Link href="/admin">← لوحة الإدارة</Link>
        <h1>إدارة السحوبات</h1>
        <p>أنشئ سحبًا، افتحه للمشاركة، ثم اسحب فائزًا عشوائيًا مرجّحًا بعدد التذاكر.</p>
      </section>

      <CreateDrawForm />

      <section className="grid" style={{ marginTop: 20 }}>
        {raffles.map((r) => (
          <article className="glass card" key={r.id}>
            <span className="badge">{r.status}</span>
            <h2>{r.title}</h2>
            <p className="muted">{r.description}</p>
            <p><strong>الجائزة:</strong> {r.prize}</p>
            <p className="muted">تكلفة التذكرة: {r.ticketCost} نقطة · {r._count.entries} مشارك{r.maxEntries ? ` · الحد: ${r.maxEntries}` : ""}</p>
            {r.winner && <p><strong>الفائز:</strong> {r.winner.username}</p>}
            <DrawActions raffleId={r.id} status={r.status} entryCount={r._count.entries} />
          </article>
        ))}
        {!raffles.length && <p>لا توجد سحوبات بعد.</p>}
      </section>
    </main>
  );
}
