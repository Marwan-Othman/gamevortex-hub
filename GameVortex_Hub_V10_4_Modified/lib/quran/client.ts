const QURAN_ENV =
  process.env.QF_ENV === "production"
    ? "production"
    : "prelive";

const OAUTH_URL =
  QURAN_ENV === "production"
    ? "https://oauth2.quran.foundation/oauth2/token"
    : "https://prelive-oauth2.quran.foundation/oauth2/token";

const API_BASE_URL =
  QURAN_ENV === "production"
    ? "https://apis.quran.foundation"
    : "https://apis-prelive.quran.foundation";

type TokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

let cachedToken: {
  accessToken: string;
  expiresAt: number;
} | null = null;

async function getAccessToken(): Promise<string> {
  const clientId = process.env.QURAN_CLIENT_ID;
  const clientSecret = process.env.QURAN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("QURAN_API_CREDENTIALS_MISSING");
  }

  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.accessToken;
  }

  const credentials = Buffer.from(
    `${clientId}:${clientSecret}`,
  ).toString("base64");

  const response = await fetch(OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "content",
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `QURAN_TOKEN_REQUEST_FAILED:${response.status}:${errorText}`,
    );
  }

  const data = (await response.json()) as TokenResponse;

  if (!data.access_token) {
    throw new Error("QURAN_ACCESS_TOKEN_MISSING");
  }

  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };

  return data.access_token;
}

export async function quranFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      "x-auth-token": token,
      "x-client-id": process.env.QURAN_CLIENT_ID!,
      ...(options.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `QURAN_API_REQUEST_FAILED:${response.status}:${errorText}`,
    );
  }

  return (await response.json()) as T;
}

export function getQuranEnvironment() {
  return QURAN_ENV;
}
