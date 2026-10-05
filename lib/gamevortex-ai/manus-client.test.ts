import { describe, expect, it } from "vitest";
import { ManusApiClient } from "./manus-client";

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("ManusApiClient", () => {
  it("rejects non-official endpoints and missing keys", () => {
    expect(() =>
      new ManusApiClient({
        baseUrl: "https://example.com",
        apiKey: "secret",
      }),
    ).toThrow("MANUS_API_BASE_URL_MUST_BE_OFFICIAL");

    expect(() => new ManusApiClient({})).toThrow("MANUS_API_KEY_REQUIRED");
  });

  it("creates a private Arabic task using the documented v2 payload", async () => {
    let receivedUrl = "";
    let receivedInit: RequestInit | undefined;

    const client = new ManusApiClient({
      apiKey: "manus-secret",
      fetcher: async (url, init) => {
        receivedUrl = String(url);
        receivedInit = init;
        return ok({
          ok: true,
          request_id: "req-1",
          task_id: "task_1",
          task_url: "https://manus.im/app/task_1",
          task_title: "GameVortex",
        });
      },
    });

    const result = await client.createTask({
      content: "حلل هذا الطلب",
      title: "GameVortex",
      agentProfile: "lite",
    });

    expect(result).toMatchObject({
      requestId: "req-1",
      taskId: "task_1",
      taskUrl: "https://manus.im/app/task_1",
      title: "GameVortex",
    });

    expect(receivedUrl).toBe("https://api.manus.ai/v2/task.create");
    expect(receivedInit?.headers).toMatchObject({
      "x-manus-api-key": "manus-secret",
    });

    expect(JSON.parse(String(receivedInit?.body))).toMatchObject({
      message: {
        content: "حلل هذا الطلب",
        visibility: "private",
      },
      locale: "ar",
      hide_in_task_list: true,
      share_visibility: "private",
      agent_profile: "lite",
      title: "GameVortex",
    });
  });

  it("builds documented task.listMessages parameters", async () => {
    let receivedUrl = "";

    const client = new ManusApiClient({
      apiKey: "key",
      fetcher: async (url) => {
        receivedUrl = String(url);
        return ok({
          ok: true,
          request_id: "req-2",
          task_id: "task_1",
          messages: [],
        });
      },
    });

    await client.listMessages("task_1", "cursor-1", 100);

    expect(receivedUrl).toBe(
      "https://api.manus.ai/v2/task.listMessages?task_id=task_1&order=asc&limit=100&cursor=cursor-1",
    );
  });

  it("normalizes authentication and rate-limit failures", async () => {
    const auth = new ManusApiClient({
      apiKey: "key",
      fetcher: async () =>
        new Response(JSON.stringify({ ok: false, error: "unauthenticated" }), {
          status: 401,
        }),
    });

    await expect(auth.listUsage()).rejects.toThrow("MANUS_AUTH_FAILED");

    const limited = new ManusApiClient({
      apiKey: "key",
      fetcher: async () =>
        new Response(JSON.stringify({ ok: false, error: "rate limit" }), {
          status: 429,
        }),
    });

    await expect(limited.listUsage()).rejects.toThrow("MANUS_RATE_LIMITED");
  });
});
