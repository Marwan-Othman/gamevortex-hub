import Link from "next/link";
import { db } from "../../../lib/prisma";
import { requireOwner } from "../../../lib/auth";

export const dynamic = "force-dynamic";

function timeAgo(date: Date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `منذ ${seconds} ثانية`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `منذ ${days} يوم`;
}

export default async function AdminErrors({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  try {
    await requireOwner();
  } catch (error) {
    const message = error instanceof Error ? error.message : "FORBIDDEN";
    return (
      <main className="wrap" dir="rtl">
        <section className="glass card" style={{ textAlign: "center", padding: 60, margin: "40px auto", maxWidth: 480 }}>
          {message === "UNAUTHORIZED" ? (
            <>
              <h1>سجّل الدخول للوصول لسجل الأخطاء</h1>
              <p className="muted" style={{ margin: "10px 0 20px" }}>تحتاج لتسجيل الدخول بحساب المالك.</p>
              <Link href="/auth/login" className="btn">تسجيل الدخول</Link>
            </>
          ) : (
            <>
              <h1>ليس لديك صلاحية الوصول</h1>
              <p className="muted" style={{ margin: "10px 0 20px" }}>هذه الصفحة مخصصة لحساب المالك فقط.</p>
              <Link href="/" className="btn">العودة للرئيسية</Link>
            </>
          )}
        </section>
      </main>
    );
  }
  const { scope } = await searchParams;
  const cleanScope = (scope || "").trim().slice(0, 120);

  const [errors, scopes, last24hCount] = await Promise.all([
    db.systemError.findMany({
      where: cleanScope ? { scope: cleanScope } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.systemError.findMany({
      select: { scope: true },
      distinct: ["scope"],
      orderBy: { scope: "asc" },
    }),
    db.systemError.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
  ]);

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <Link href="/admin">← الإدارة</Link>
        <h1>سجل الأخطاء (System Errors)</h1>
        <p className="muted">
          آخر 100 خطأ مسجَّل من عمليات الدفع، السحب، الذكاء الاصطناعي، وواجهة
          المستخدم. هذا السجل مخصص للتشخيص فقط ولا يُستخدم لأي قرار تلقائي.
        </p>
        <div className="action-row">
          <span className="badge">{last24hCount} خطأ خلال 24 ساعة</span>
        </div>
      </section>

      <section className="glass card">
        <form method="get" className="filter-row">
          <select className="input" name="scope" defaultValue={cleanScope}>
            <option value="">كل الأقسام</option>
            {scopes.map((s) => (
              <option key={s.scope} value={s.scope}>
                {s.scope}
              </option>
            ))}
          </select>
          <button className="btn" type="submit">
            تصفية
          </button>
          {cleanScope && (
            <Link className="btn secondary" href="/admin/errors">
              إلغاء التصفية
            </Link>
          )}
        </form>
      </section>

      <section className="grid">
        {errors.map((e) => (
          <article key={e.id} className="glass card" style={{ padding: 16 }}>
            <div className="card-top">
              <span className="badge">{e.scope}</span>
              {e.statusCode ? <span className="muted">HTTP {e.statusCode}</span> : null}
            </div>
            <p style={{ marginTop: 8, fontWeight: 600 }}>{e.message}</p>
            <p className="muted" style={{ marginTop: 4 }}>
              {timeAgo(e.createdAt)}
              {e.userId ? ` · مستخدم: ${e.userId}` : ""}
            </p>
            {e.metadata ? (
              <pre
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  opacity: 0.7,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {JSON.stringify(e.metadata, null, 2)}
              </pre>
            ) : null}
          </article>
        ))}
        {!errors.length && (
          <section className="glass card">
            <h2>لا توجد أخطاء مسجلة</h2>
            <p className="muted">لم يتم تسجيل أي خطأ في هذا القسم حتى الآن.</p>
          </section>
        )}
      </section>
    </main>
  );
}
