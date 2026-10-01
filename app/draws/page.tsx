import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import EnterDrawButton from "@/components/draws/EnterDrawButton";

export const dynamic = "force-dynamic";

export default async function Draws() {
  const draws = await db.raffle.findMany({
    where: { status: { in: ["OPEN", "DRAWN"] } },
    orderBy: { drawAt: "asc" },
    take: 20,
    include: { _count: { select: { entries: true } } },
  });

  const user = await requireUser().catch(() => null);
  const myEntries = user
    ? await db.raffleEntry.findMany({ where: { userId: user.id, raffleId: { in: draws.map((d) => d.id) } } })
    : [];
  const ticketsByRaffle = new Map(myEntries.map((entry) => [entry.raffleId, entry.tickets]));

  return (
    <main className="wrap">
      <section className="hero">
        <div className="eyebrow">VORTEX DRAWS</div>
        <h1>السحوبات والجوائز.</h1>
        <p>سحوبات مستقلة يديرها GameVortex. التذاكر والحالة والفائز تحفظ في قاعدة بيانات المشروع.</p>
        {user && <p className="muted">رصيدك الحالي: {user.points} نقطة</p>}
        {!user && <p className="muted">سجّل الدخول لدخول السحوبات المفتوحة بنقاطك.</p>}
      </section>
      <div className="grid" style={{ marginTop: 20 }}>
        {draws.map((d) => (
          <article className="card" key={d.id}>
            <span className="badge">{d.status}</span>
            <h2>{d.title}</h2>
            <p className="muted">{d.description}</p>
            <p><strong>الجائزة:</strong> {d.prize}</p>
            <p className="muted">تكلفة التذكرة: {d.ticketCost} نقطة · {d._count.entries} مشارك</p>
            {d.status === "DRAWN" && (
              <p className="muted">{d.winnerId === user?.id ? "🎉 أنت الفائز بهذا السحب!" : "تم سحب الفائز."}</p>
            )}
            {d.status === "OPEN" && user && (
              <EnterDrawButton
                raffleId={d.id}
                ticketCost={d.ticketCost}
                userPoints={user.points}
                alreadyEnteredTickets={ticketsByRaffle.get(d.id) ?? 0}
              />
            )}
            {d.status === "OPEN" && !user && <p className="muted">سجّل الدخول لدخول هذا السحب.</p>}
          </article>
        ))}
        {!draws.length && (
          <div className="card">
            <h2>لا توجد سحوبات مفتوحة حاليًا</h2>
            <p className="muted">يمكن للمالك إنشاء السحوبات من لوحة الإدارة بعد تجهيز قواعد الجوائز.</p>
          </div>
        )}
      </div>
    </main>
  );
}
