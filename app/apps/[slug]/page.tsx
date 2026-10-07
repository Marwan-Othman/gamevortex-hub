import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/prisma";
import { getPlatformSlugFromEnum } from "@/lib/platforms";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  const app = await db.app.findFirst({
    where: { slug, published: true },
    select: {
      nameAr: true,
      nameEn: true,
      descriptionAr: true,
      descriptionEn: true,
      coverUrl: true,
      iconUrl: true,
      slug: true,
    },
  });

  if (!app) {
    return { title: "التطبيق غير موجود | GameVortex Hub" };
  }

  const title = `${app.nameAr} | GameVortex Hub`;

  const description = (
    app.descriptionAr ||
    app.descriptionEn ||
    `اكتشف ${app.nameEn} على GameVortex Hub.`
  ).slice(0, 160);

  const base = process.env.APP_ORIGIN?.trim() || "http://localhost:3000";
  const canonical = `${base}/apps/${app.slug}`;
  const image = app.coverUrl || app.iconUrl;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      images: image ? [{ url: image }] : [],
    },
  };
}

export default async function AppDetails({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const app = await db.app.findFirst({
    where: { slug, published: true },
    include: { appPlatforms: true, appCategories: { include: { category: true } } },
  });

  if (!app) notFound();

  const relatedCategoryIds = app.appCategories.map((item) => item.categoryId);

  const relatedApps = relatedCategoryIds.length
    ? await db.app.findMany({
        where: {
          published: true,
          id: { not: app.id },
          appCategories: { some: { categoryId: { in: relatedCategoryIds } } },
        },
        orderBy: [{ ratingAverage: "desc" }, { ratingCount: "desc" }],
        take: 6,
      })
    : [];

  return (
    <main className="wrap">
      <Link href="/apps">← التطبيقات</Link>

      <section className="glass hero game-detail" style={{ marginTop: 16 }}>
        <div className="detail-cover" style={{ display: "grid", placeItems: "center", overflow: "hidden" }}>
          {app.coverUrl ? (
            <img src={app.coverUrl} alt={app.nameAr} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : app.iconUrl ? (
            <img src={app.iconUrl} alt={app.nameAr} style={{ width: "70%", height: "70%", objectFit: "cover", borderRadius: 24 }} />
          ) : (
            <span style={{ fontSize: 70 }}>◈</span>
          )}
        </div>

        <div>
          <span className="badge">APP</span>
          <h1>{app.nameAr}</h1>
          <p className="muted">{app.nameEn}</p>

          {app.developer && <p><strong>المطور:</strong> {app.developer}</p>}
          {app.publisher && <p><strong>الناشر:</strong> {app.publisher}</p>}

          <p>{app.descriptionAr || app.descriptionEn || "لا يوجد وصف متاح لهذا التطبيق."}</p>

          <div className="stat-row">
            <span>★ {app.ratingAverage.toFixed(1)} ({app.ratingCount})</span>
            <span>👁 {app.viewCount}</span>
            <span>⬇ {app.downloadCount}</span>
          </div>

          <div className="tabs">
            {app.appPlatforms.map((x) => (
              <span className="badge" key={x.platform}>{getPlatformSlugFromEnum(x.platform)}</span>
            ))}
            {app.appCategories.map((x) => (
              <span className="badge" key={x.id}>{x.category.nameAr}</span>
            ))}
          </div>

          <div className="action-row" style={{ marginTop: 18 }}>
            {app.downloadSource && (
              <a className="btn" href={`/download/app/${app.slug}`}>
                تحميل التطبيق
              </a>
            )}
            {app.officialUrl && (
              <a className="btn secondary" href={app.officialUrl} target="_blank" rel="noreferrer">
                المصدر الرسمي
              </a>
            )}
          </div>
        </div>
      </section>

      {relatedApps.length > 0 && (
        <section>
          <h2>تطبيقات ذات صلة</h2>

          <div className="grid">
            {relatedApps.map((related) => (
              <Link href={`/apps/${related.slug}`} className="glass card" key={related.id}>
                {(related.iconUrl || related.coverUrl) && (
                  <img
                    src={related.iconUrl || related.coverUrl || ""}
                    alt={related.nameEn}
                    style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 16, marginBottom: 8 }}
                  />
                )}

                <h3>{related.nameAr}</h3>
                <p className="muted">{related.nameEn}</p>
                <p>★ {related.ratingAverage.toFixed(1)} ({related.ratingCount})</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
