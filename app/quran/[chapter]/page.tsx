import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getChapterAudioUrl,
  getChapterReciters,
  getChapters,
  getChapterVerses,
  type Chapter,
  type ChapterReciter,
  type Pagination,
  type Verse,
} from "@/lib/quran-foundation";

const BISMILLAH = "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ";
const PER_PAGE = 50;
const DEFAULT_RECITER_ID = 7;

const STYLE_AR: Record<string, string> = {
  Murattal: "مرتّل",
  Mujawwad: "مجوّد",
  Muallim: "معلّم",
  "Kids repeat": "ترديد الأطفال",
};

function reciterLabel(r: ChapterReciter) {
  const name = r.translated_name?.name || r.name;
  const styleName = r.style?.name;
  const style = styleName ? (STYLE_AR[styleName] ?? styleName) : "";
  return style ? `${name} · ${style}` : name;
}

type Props = {
  params: Promise<{ chapter: string }>;
  searchParams: Promise<{ page?: string; reciter?: string }>;
};

export default async function ChapterPage({ params, searchParams }: Props) {
  const { chapter } = await params;
  const { page, reciter } = await searchParams;

  const id = Number(chapter);
  if (!Number.isInteger(id) || id < 1 || id > 114) notFound();
  const pageNo = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);

  let info: Chapter | undefined;
  let verses: Verse[] = [];
  let pagination: Pagination | null = null;
  let failed = false;

  try {
    const [chapters, data] = await Promise.all([
      getChapters(),
      getChapterVerses(id, pageNo, PER_PAGE),
    ]);
    info = chapters.find((c) => c.id === id);
    verses = data.verses;
    pagination = data.pagination;
  } catch (error) {
    console.error("quran chapter load failed", error);
    failed = true;
  }

  let reciters: ChapterReciter[] = [];
  let selected: ChapterReciter | undefined;
  let audioUrl: string | null = null;
  try {
    reciters = await getChapterReciters();
    const wanted = Number.parseInt(reciter ?? "", 10);
    selected =
      reciters.find((r) => r.id === wanted) ??
      reciters.find((r) => r.id === DEFAULT_RECITER_ID) ??
      reciters[0];
    if (selected) audioUrl = await getChapterAudioUrl(selected.id, id);
  } catch (error) {
    console.error("quran audio load failed", error);
  }

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <h1>{info ? `سورة ${info.name_arabic}` : `سورة رقم ${id}`}</h1>
        {info && (
          <p className="muted">
            {info.verses_count} آية · {info.revelation_place === "makkah" ? "مكية" : "مدنية"}
          </p>
        )}
        <p>
          <Link href="/quran">← كل السور</Link>
        </p>
      </section>

      {reciters.length > 0 && (
        <section className="glass card" style={{ marginBottom: 16 }}>
          <h2>الاستماع</h2>
          <form
            method="get"
            style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
          >
            <input type="hidden" name="page" value={pageNo} />
            <select className="input" name="reciter" defaultValue={selected?.id} aria-label="القارئ">
              {reciters.map((r) => (
                <option key={r.id} value={r.id}>
                  {reciterLabel(r)}
                </option>
              ))}
            </select>
            <button className="btn" type="submit">
              تغيير القارئ
            </button>
          </form>
          {audioUrl ? (
            <audio controls preload="none" src={audioUrl} style={{ width: "100%", marginTop: 12 }} />
          ) : (
            <p className="muted">تعذر تحميل التلاوة لهذا القارئ.</p>
          )}
          <p className="muted" style={{ fontSize: "0.85rem" }}>
            التلاوة عبر Quran Foundation API
          </p>
        </section>
      )}

      {failed ? (
        <p className="glass card muted">تعذر تحميل السورة حاليًا، حاول مرة أخرى بعد قليل.</p>
      ) : (
        <article className="glass card">
          {info?.bismillah_pre && pageNo === 1 && (
            <p style={{ textAlign: "center", fontSize: "1.6rem", lineHeight: 2.2 }}>{BISMILLAH}</p>
          )}
          <p
            style={{
              fontFamily: "'Amiri', 'Traditional Arabic', 'Scheherazade New', serif",
              fontSize: "1.7rem",
              lineHeight: 2.4,
              textAlign: "justify",
            }}
          >
            {verses.map((v) => (
              <span key={v.id}>
                {v.text_uthmani}{" "}
                <span className="muted" style={{ fontSize: "1.1rem" }}>
                  ﴿{v.verse_number.toLocaleString("ar-EG")}﴾
                </span>{" "}
              </span>
            ))}
          </p>
        </article>
      )}

      {pagination && pagination.total_pages > 1 && (
        <nav
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}
        >
          {pageNo > 1 ? (
            <Link className="btn" href={`/quran/${id}?page=${pageNo - 1}${selected ? `&reciter=${selected.id}` : ""}`}>
              السابق
            </Link>
          ) : (
            <span />
          )}
          <span className="muted">
            {pageNo} / {pagination.total_pages}
          </span>
          {pagination.next_page ? (
            <Link className="btn" href={`/quran/${id}?page=${pagination.next_page}${selected ? `&reciter=${selected.id}` : ""}`}>
              التالي
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  );
}
