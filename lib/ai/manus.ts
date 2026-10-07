import { randomUUID } from "node:crypto";
import { AiProviderError, type AiChatInput, type AiChatResult } from "@/lib/ai/types";

function getBaseUrl() {
  return (process.env.MANUS_API_BASE_URL?.trim() || "https://api.manus.ai").replace(/\/$/, "");
}
const REQUEST_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_MS = 240_000;

function getKey() {
  const value = process.env.MANUS_API_KEY?.trim();
  if (!value) throw new AiProviderError({ provider: "manus", code: "NOT_CONFIGURED" });
  if (value.length > 4096 || /[\r\n]/.test(value)) throw new AiProviderError({ provider: "manus", code: "CONFIGURATION_INVALID" });
  return value;
}

async function request(path: string, init: RequestInit, signal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(getBaseUrl() + path, {
      ...init,
      signal: controller.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json", "x-manus-api-key": getKey(), "X-Request-Id": randomUUID(), ...(init.headers || {}) },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new AiProviderError({ provider: "manus", code: "AUTH_FAILED", status: response.status, failoverable: true });
      if (response.status === 429) throw new AiProviderError({ provider: "manus", code: "RATE_LIMITED", status: response.status, retryable: true, failoverable: true });
      if (response.status >= 500) throw new AiProviderError({ provider: "manus", code: "UNAVAILABLE", status: response.status, retryable: true, failoverable: true });
      throw new AiProviderError({ provider: "manus", code: "PROVIDER_ERROR", status: response.status });
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (controller.signal.aborted) throw new AiProviderError({ provider: "manus", code: "TIMEOUT", retryable: true, failoverable: true });
    throw new AiProviderError({ provider: "manus", code: "UNAVAILABLE", retryable: true, failoverable: true });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

async function createTask(content: string, signal?: AbortSignal) {
  const body = await request("/v2/task.create", {
    method: "POST",
    body: JSON.stringify({
      message: { content: [{ type: "text", text: content, visibility: "visible" }] },
      locale: "ar",
      interactive_mode: false,
      hide_in_task_list: true,
      share_visibility: "private",
      agent_profile: process.env.MANUS_AGENT_PROFILE || "standard",
      title: "GameVortex AI",
    }),
  }, signal);
  const taskId = typeof body.task_id === "string" ? body.task_id : "";
  if (!taskId) throw new AiProviderError({ provider: "manus", code: "INVALID_TASK_RESPONSE", failoverable: true });
  return { taskId, requestId: typeof body.request_id === "string" ? body.request_id : undefined };
}

async function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new AiProviderError({ provider: "manus", code: "CANCELLED" }));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function poll(taskId: string, signal?: AbortSignal) {
  const deadline = Date.now() + MAX_POLL_MS;
  while (Date.now() < deadline) {
    const detail = await request("/v2/task.detail?task_id=" + encodeURIComponent(taskId), { method: "GET" }, signal);
    const task = detail.task && typeof detail.task === "object" ? detail.task as { status?: string; has_running_background_jobs?: boolean } : {};
    if (task.status === "error") throw new AiProviderError({ provider: "manus", code: "TASK_FAILED", failoverable: true });
    if (task.status === "waiting") throw new AiProviderError({ provider: "manus", code: "TASK_WAITING", failoverable: false });
    if (task.status === "stopped" && task.has_running_background_jobs === false) {
      const result = await request("/v2/task.listMessages?task_id=" + encodeURIComponent(taskId) + "&order=desc&limit=100", { method: "GET" }, signal);
      const messages = Array.isArray(result.messages) ? result.messages : [];
      for (const item of messages) {
        if (!item || typeof item !== "object") continue;
        const structured = (item as { structured_output_result?: { success?: boolean; value?: unknown } }).structured_output_result;
        if (structured?.success && structured.value && typeof structured.value === "object") {
          const answer = (structured.value as { answer?: unknown }).answer;
          if (typeof answer === "string" && answer.trim()) return answer.trim();
        }
        const assistant = (item as { assistant_message?: { content?: unknown } }).assistant_message?.content;
        if (typeof assistant === "string" && assistant.trim()) return assistant.trim();
        if (Array.isArray(assistant)) {
          const text = assistant.filter(part => part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string").map(part => (part as { text: string }).text).join("").trim();
          if (text) return text;
        }
      }
      throw new AiProviderError({ provider: "manus", code: "EMPTY_RESPONSE", failoverable: true });
    }
    await sleep(POLL_INTERVAL_MS, signal);
  }
  throw new AiProviderError({ provider: "manus", code: "TIMEOUT", retryable: true, failoverable: true });
}

export async function manusChat(input: AiChatInput): Promise<AiChatResult> {
  const started = Date.now();
  const history = (input.history || []).map(message => (message.role === "assistant" ? "GameVortex AI: " : "User: ") + message.content).join("\n\n");
  const content = [input.systemInstruction, history, "User: " + input.prompt].filter(Boolean).join("\n\n");
  const task = await createTask(content, input.signal);
  const answer = await poll(task.taskId, input.signal);
  return { provider: "manus", model: "manus", answer, providerRequestId: task.requestId || randomUUID(), latencyMs: Date.now() - started };
}
