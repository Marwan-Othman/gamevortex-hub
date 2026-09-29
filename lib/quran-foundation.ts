type QfEnv = "production" | "prelive";

const HOSTS: Record<QfEnv, { auth: string; api: string }> = {
  production: {
    auth: "https://oauth2.quran.foundation",
    api: "https://apis.quran.foundation",
  },
  prelive: {
    auth: "https://prelive-oauth2.quran.foundation",
    api: "https://apis-prelive.quran.foundation",
  },
};

export type Chapter = {
  id: number;
  name_simple: string;
  name_arabic: string;
  revelation_place: string;
  verses_count: number;
  bismillah_pre: boolean;
  translated_name?: { name: string };
};

export type Verse = {
  id: number;
  verse_number: number;
  verse_key: string;
  text_uthmani?: string;
};

export type ChapterReciter = {
  id: number;
  name: string;
  style?: { name: string | null } | null;
  translated_name?: { name: string } | null;
};

export type Pagination = {
  per_page: number;
  current_page: number;
  next_page: number | null;
  total_pages: number;
  total_records: number;
};

function getConfig() {
  const clientId = process.env.QF_CLIENT_ID?.trim();
  const clientSecret = process.env.QF_CLIENT_SECRET?.trim();
  const env: QfEnv = process.env.QF_ENV === "prelive" ? "prelive" : "production";
  if (!clientId || !clientSecret) throw new Error("QURAN_API_NOT_CONFIGURED");
  return { clientId, clientSecret, ...HOSTS[env] };
}

let cached: { token: string; expiresAt: number } | null = null;
let pending: Promise<string> | null = null;

async function requestToken(): Promise<string> {
  const { clientId, clientSecret, auth } = getConfig();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${auth}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=content",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`QURAN_AUTH_FAILED_${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  const ttlMs = (data.expires_in ?? 3600) * 1000;
  cached = { token: data.access_token, expiresAt: Date.now() + ttlMs - 60_000 };
  return data.access_token;
}

async function getToken(force = false): Promise<string> {
  if (!force && cached && cached.expiresAt > Date.now()) return cached.token;
  if (!pending) {
    pending = requestToken().finally(() => {
      pending = null;
    });
  }
  return pending;
}

type Params = Record<string, string | number | boolean | undefined>;

export async function qfGet<T>(
  path: string,
  params: Params = {},
  revalidate = 86400,
): Promise<T> {
  const { clientId, api } = getConfig();
  const url = new URL(`${api}/content/api/v4${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const call = (token: string) =>
    fetch(url, {
      headers: {
        "x-auth-token": token,
        "x-client-id": clientId,
        Accept: "application/json",
      },
      next: { revalidate },
    });

  let res = await call(await getToken());
  if (res.status === 401) res = await call(await getToken(true));
  if (!res.ok) throw new Error(`QURAN_API_${res.status}`);
  return (await res.json()) as T;
}

export async function getChapters(): Promise<Chapter[]> {
  const data = await qfGet<{ chapters: Chapter[] }>("/chapters", { language: "ar" });
  return data.chapters;
}

export async function getChapterVerses(chapter: number, page = 1, perPage = 50) {
  return qfGet<{ verses: Verse[]; pagination: Pagination }>(
    `/verses/by_chapter/${chapter}`,
    {
      language: "ar",
      fields: "text_uthmani",
      words: false,
      per_page: perPage,
      page,
    },
  );
}

export async function getChapterReciters(): Promise<ChapterReciter[]> {
  const data = await qfGet<{ reciters: ChapterReciter[] }>("/resources/chapter_reciters", {
    language: "ar",
  });
  return data.reciters;
}

export async function getChapterAudioUrl(
  reciterId: number,
  chapter: number,
): Promise<string | null> {
  const data = await qfGet<{ audio_file?: { audio_url?: string } }>(
    `/chapter_recitations/${reciterId}/${chapter}`,
  );
  const url = data.audio_file?.audio_url;
  return url && url.startsWith("https://") ? url : null;
}
