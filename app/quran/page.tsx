export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/lib/prisma";
import { getChapters, type Chapter } from "@/lib/quran-foundation";

export const metadata = { title: "القرآن الكريم | GameVortex Hub" };

export default async function Quran() {
  let chapters: Chapter[] = [];
  let chaptersFailed = false;
  try {
    chapters = await getChapters();
  } catch (error) {
    console.error("quran chapters load failed", error);
    chaptersFailed = true;
  }

  const reciters = await db.quranReciter.findMany({
    where: { active: true, sourceVerificationStatus: "VERIFIED" },
    orderBy: [{ sortOrder: "asc" }, { nameAr: "asc" }],
    select: {
      id: true,
      nameAr: true,
      nameEn: true,
      riwayah: true,
      style: true,
      quality: true,
      provider: true,
      legalSourceUrl: true,
      audioBaseUrl: true,
      availableSurahs: true,
    },
  });

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <h1>القرآن الكريم</h1>
        <p>اقرأ السور بالرسم العثماني، واستمع إلى التلاوة داخل صفحة كل سورة.</p>
      </section>

      <h2>السور</h2>
      {chaptersFailed ? (
        <p className="glass card muted">تعذر تحميل السور حاليًا، حاول مرة أخرى بعد قليل.</p>
      ) : (
        <div className="grid">
          {chapters.map((c) => (
            <Link
              key={c.id}
              href={`/quran/${c.id}`}
              className="glass card"
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <h3>
                {c.id}. {c.name_arabic}
              </h3>
              <p className="muted">
                {c.name_simple} · {c.verses_count} آية ·{" "}
                {c.revelation_place === "makkah" ? "مكية" : "مدنية"}
              </p>
            </Link>
          ))}
        </div>
      )}

      {reciters.length > 0 && (
        <>
          <h2>القراء</h2>
          <div className="grid">
            {reciters.map((r) => (
              <article className="glass card" key={r.id}>
                <h3>{r.nameAr}</h3>
                <p>{r.nameEn}</p>
                <p className="muted">
                  {r.riwayah ?? "—"} · {r.quality ?? "—"} · {r.provider}
                </p>
                <audio controls preload="none" src={`${r.audioBaseUrl.replace(/\/$/, "")}/001.mp3`} />
                <p>
                  <a href={r.legalSourceUrl} target="_blank" rel="noreferrer">
                    المصدر الرسمي
                  </a>
                </p>
              </article>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
