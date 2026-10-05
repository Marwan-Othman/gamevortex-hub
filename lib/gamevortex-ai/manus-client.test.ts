import { describe, expect, it } from "vitest";
import { ManusApiClient } from "./manus-client";

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("ManusApiClient", () => {
  it("rejects non-official endpoints and missing keys", () => {
    expect(() => new ManusApiClient({ baseUrl: "https://example.com", apiKey: "secret" })).toThrow("MANUS_API_BASE_URL_MUST_BE_OFFICIAL");
    expect(() => new ManusApiClient({})).toThrow("MANUS_API_KEY_REQUIRED");
  });

  it("creates a private Arabic task with the documented header", async () => {
    let receivedUrl = "";
    let receivedInit: RequestInit | undefined;
    const client = new ManusApiClient({ apiKey: "manus-secret", fetcher: async (url, init) => {
      receivedUrl = String(url);
      receivedInit = init;
      return ok({ success: true, request_id: "req-1", task_id: "task_1", task_url: "https://manus.im/app/task_1", title: "GameVortex" });
    } });
    const result = await client.createTask({ content: "حلل هذا الطلب", title: "GameVortex", agentProfile: "lite" });
    expect(result).toMatchObject({ requestId: "req-1", taskId: "task_1" });
    expect(receivedUrl).toBe("https://api.manus.ai/v2/task.create");
    expect(receivedInit?.headers).toMatchObject({ "x-manus-api-key": "manus-secret" });
    expect(JSON.parse(String(receivedInit?.body))).toMatchObject({ message: { role: "user", content: "حلل هذا الطلب" }, locale: "ar", hidden: true, agent_profile: "lite" });
  });

  it("normalizes authentication and rate-limit failures", async () => {
    const auth = new ManusApiClient({ apiKey: "key", fetcher: async () => new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 }) });
    await expect(auth.listUsage()).rejects.toThrow("MANUS_AUTH_FAILED");
    const limited = new ManusApiClient({ apiKey: "key", fetcher: async () => new Response(JSON.stringify({ error: "rate limit" }), { status: 429 }) });
    await expect(limited.listUsage()).rejects.toThrow("MANUS_RATE_LIMITED");
  });
});
