import { randomUUID } from "node:crypto";

const DEFAULT_BASE_URL = "https://api.manus.ai";

type ManusFetcher = typeof fetch;

type ManusResponse = {
  success?: boolean;
  request_id?: string;
  task_id?: string;
  task_url?: string;
  title?: string;
  share_url?: string;
  share_visibility?: string;
  has_more?: boolean;
  next_cursor?: string;
  usage?: unknown[];
  data?: unknown;
  error?: { code?: string; message?: string } | string;
};

export type ManusTaskCreateInput = {
  content: string;
  title?: string;
  locale?: string;
  agentProfile?: "lite" | "standard" | "max";
  structuredOutputSchema?: Record<string, unknown>;
  hidden?: boolean;
};

export type ManusTaskCreated = {
  requestId: string;
  taskId: string;
  taskUrl: string;
  title: string | null;
};

export type ManusClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetcher?: ManusFetcher;
};

function baseUrl(value: string | undefined): string {
  const normalized = (value ?? process.env.MANUS_API_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/$/, "");
  if (normalized !== DEFAULT_BASE_URL) throw new Error("MANUS_API_BASE_URL_MUST_BE_OFFICIAL");
  return normalized;
}

function apiKey(value: string | undefined): string {
  const key = value?.trim() || process.env.MANUS_API_KEY?.trim();
  if (!key) throw new Error("MANUS_API_KEY_REQUIRED");
  if (key.length > 512 || /[\r\n]/.test(key)) throw new Error("MANUS_API_KEY_INVALID");
  return key;
}

async function parseResponse(response: Response): Promise<ManusResponse> {
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error("MANUS_INVALID_RESPONSE"); }
  if (!payload || typeof payload !== "object") throw new Error("MANUS_INVALID_RESPONSE");
  const body = payload as ManusResponse;
  if (!response.ok || body.success === false) {
    const raw = typeof body.error === "string" ? body.error : body.error?.message;
    const message = String(raw ?? "").toLowerCase();
    if (response.status === 401 || message.includes("unauthenticated") || message.includes("api key")) throw new Error("MANUS_AUTH_FAILED");
    if (response.status === 429 || message.includes("rate")) throw new Error("MANUS_RATE_LIMITED");
    if (response.status >= 500) throw new Error("MANUS_UNAVAILABLE");
    throw new Error("MANUS_PROVIDER_ERROR");
  }
  return body;
}

export class ManusApiClient {
  private readonly key: string;
  private readonly url: string;
  private readonly fetcher: ManusFetcher;

  constructor(options: ManusClientOptions = {}) {
    this.key = apiKey(options.apiKey);
    this.url = baseUrl(options.baseUrl);
    this.fetcher = options.fetcher ?? fetch;
  }

  private async request(path: string, init: RequestInit): Promise<ManusResponse> {
    const requestId = randomUUID();
    let response: Response;
    try {
      response = await this.fetcher(`${this.url}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-manus-api-key": this.key,
          "X-Request-Id": requestId,
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new Error("MANUS_UNAVAILABLE");
    }
    return parseResponse(response);
  }

  async createTask(input: ManusTaskCreateInput): Promise<ManusTaskCreated> {
    const content = input.content.trim();
    if (!content || content.length > 30_000) throw new Error("MANUS_INVALID_TASK_CONTENT");
    const body: Record<string, unknown> = {
      message: { role: "user", content },
      locale: input.locale ?? "ar",
      hidden: input.hidden ?? true,
    };
    if (input.title?.trim()) body.title = input.title.trim().slice(0, 200);
    if (input.agentProfile) body.agent_profile = input.agentProfile;
    if (input.structuredOutputSchema) body.structured_output_schema = input.structuredOutputSchema;
    const result = await this.request("/v2/task.create", { method: "POST", body: JSON.stringify(body) });
    if (!result.task_id || !result.task_url) throw new Error("MANUS_INVALID_TASK_RESPONSE");
    return {
      requestId: result.request_id ?? "",
      taskId: result.task_id,
      taskUrl: result.task_url,
      title: result.title ?? null,
    };
  }

  async listMessages(taskId: string, cursor?: string): Promise<ManusResponse> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(taskId)) throw new Error("MANUS_INVALID_TASK_ID");
    const query = new URLSearchParams({ task_id: taskId });
    if (cursor) query.set("cursor", cursor);
    return this.request(`/v2/task.listMessages?${query.toString()}`, { method: "GET" });
  }

  async listUsage(cursor?: string, limit = 20): Promise<ManusResponse> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("MANUS_INVALID_USAGE_LIMIT");
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set("cursor", cursor);
    return this.request(`/v2/usage.list?${query.toString()}`, { method: "GET" });
  }
}
