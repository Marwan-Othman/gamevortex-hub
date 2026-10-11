import Link from "next/link";
import { db } from "@/lib/prisma";
import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import ModerationReportActions from "@/components/admin/ModerationReportActions";

export const dynamic = "force-dynamic";

const REASONS: Record<string, string> = {
  SPAM: "رسائل مزعجة",
  ABUSE: "إساءة",
  FRAUD: "احتيال",
  COPYRIGHT: "حقوق نشر",
  NSFW: "محتوى غير لائق",
  MISLEADING: "معلومات مضللة",
  OTHER: "أخرى",
};

const TARGETS: Record<string, string> = {
  GAME: "لعبة",
  REVIEW: "تقييم",
  USER: "مستخدم",
  ACTIVITY: "نشاط",
};

/**
 * One moderation hub: user reports + the wallpaper review queue (which used
 * to be a separate, unlinked screen).
 */
export default async function Moderation() {
  const gate = await getOwnerOrAccessScreen();
  if ("screen" in gate) return gate.screen;

  const [reports, pendingWallpapers] = await Promise.all([
    db.contentReport.findMany({
      where: { status: "PENDING" },
      include: { reporter: { select: { username: true, email: true } } },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    db.wallpaper.count({ where: { moderationStatus: "PENDING" } }),
  ]);

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <span className="badge">المراجعة والإشراف</span>
        <h1>قائمة المراجعة</h1>
        <p className="muted">
          راجع بلاغات المستخدمين والخلفيات المرفوعة قبل أن تتحول إلى مشاكل في
          الموقع.
        </p>
      </section>

      <section className="glass card" style={{ marginTop: 20 }}>
        <h2>الخلفيات بانتظار المراجعة</h2>
        <p className="muted" style={{ margin: "6px 0 12px" }}>
          {pendingWallpapers > 0
            ? `${pendingWallpapers} خلفية مرفوعة من المستخدمين لا تظهر للعامة قبل الموافقة.`
            : "لا توجد خلفيات معلقة حاليًا."}
        </p>
        <Link className="btn" href="/admin/wallpapers/moderation">
          فتح مراجعة الخلفيات
        </Link>
      </section>

      <div className="section-head" style={{ marginTop: 24 }}>
        <h2>بلاغات المحتوى ({reports.length})</h2>
      </div>

      <div className="grid">
        {reports.map((report) => (
          <article className="glass card" key={report.id}>
            <span className="badge">
              {REASONS[report.reason] ?? report.reason}
            </span>

            <p style={{ marginTop: 8 }}>
              <strong>{TARGETS[report.targetType] ?? report.targetType}</strong>
              <span className="muted" dir="ltr" style={{ overflowWrap: "anywhere" }}>
                {" "}
                · {report.targetId}
              </span>
            </p>

            <p>{report.details || <span className="muted">بدون تفاصيل</span>}</p>

            <small className="muted">
              المُبلِّغ: {report.reporter.username || report.reporter.email} ·{" "}
              {report.createdAt.toLocaleDateString("ar")}
            </small>

            <ModerationReportActions reportId={report.id} />
          </article>
        ))}

        {reports.length === 0 && (
          <section className="glass card">
            <h2>لا توجد بلاغات معلقة</h2>
            <p className="muted">القائمة فارغة حاليًا.</p>
          </section>
        )}
      </div>
    </main>
  );
}
