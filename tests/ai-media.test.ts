import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { downloadFile, generateImage, getCompletedVideoUri, getVideoOperation, startVideo } from "../lib/ai/media";

type Call = { url: string; headers: Record<string, string> };
const realFetch = globalThis.fetch;
let calls: Call[] = [];

function mockFetch(handler: (url: string, headers: Record<string, string>) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers || {}) as Record<string, string>;
    calls.push({ url, headers });
    return handler(url, headers);
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls = [];
  process.env.GEMINI_API_KEY = "test-key";
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("generateImage response handling", () => {
  it("returns the inline image", async () => {
    mockFetch(() => json({ steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: "iVBORw0KGgo=" }] }] }));
    await expect(generateImage({ prompt: "cat" })).resolves.toEqual({ data: "iVBORw0KGgo=", mimeType: "image/png" });
  });

  it("never relays a non-image mime type", async () => {
    mockFetch(() => json({ steps: [{ type: "model_output", content: [{ type: "image", mime_type: "text/html", data: "iVBORw0KGgo=" }] }] }));
    expect((await generateImage({ prompt: "cat" })).mimeType).toBe("image/png");
  });

  it("supports the Interactions API output_image convenience field", async () => {
    mockFetch((url, headers) => {
      expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
      expect(headers["x-goog-api-key"]).toBe("test-key");
      return json({ output_image: { mime_type: "image/png", data: "iVBORw0KGgo=" } });
    });
    await expect(generateImage({ prompt: "cat", aspectRatio: "9:16", imageSize: "1K" }))
      .resolves.toEqual({ data: "iVBORw0KGgo=", mimeType: "image/png" });
  });

  it("sends the documented image-generation request shape", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
      const body = JSON.parse(String(init?.body || "{}"));
      expect(body.model).toBe("gemini-3.1-flash-image");
      expect(body.input).toEqual("cat");
      expect(body.response_format).toMatchObject({ type: "image", aspect_ratio: "9:16", image_size: "2K" });
      expect(body.response_format.delivery).toBeUndefined();
      return json({ steps: [{ type: "model_output", content: [{ type: "image", mime_type: "image/png", data: "iVBORw0KGgo=" }] }] });
    }) as typeof fetch;
    await generateImage({ prompt: "cat", aspectRatio: "9:16", imageSize: "2K" });
  });

  it.each([
    ["no steps", {}],
    ["empty steps", { steps: [] }],
    ["text only", { steps: [{ type: "model_output", content: [{ type: "text", text: "sorry" }] }] }],
    ["non-base64 data", { steps: [{ type: "model_output", content: [{ type: "image", data: "<html>" }] }] }],
  ])("treats %s as an empty response (so the credits are refunded)", async (_name, body) => {
    mockFetch(() => json(body));
    await expect(generateImage({ prompt: "cat" })).rejects.toMatchObject({ code: "EMPTY_RESPONSE" });
  });

  it("rejects a 200 with a non-JSON body", async () => {
    mockFetch(() => new Response("<html>bad gateway</html>", { status: 200 }));
    await expect(generateImage({ prompt: "cat" })).rejects.toMatchObject({ code: "INVALID_MEDIA_RESPONSE" });
  });

  it("maps provider failures to retryable/failoverable errors", async () => {
    mockFetch(() => json({ error: {} }, 429));
    await expect(generateImage({ prompt: "cat" })).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
    mockFetch(() => json({ error: {} }, 504));
    await expect(generateImage({ prompt: "cat" })).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("fails with NOT_CONFIGURED when the key is missing", async () => {
    delete process.env.GEMINI_API_KEY;
    mockFetch(() => json({}));
    await expect(generateImage({ prompt: "cat" })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
});

describe("video helpers", () => {
  it("requires an operation name from the provider", async () => {
    mockFetch(() => json({}));
    await expect(startVideo({ prompt: "x" })).rejects.toMatchObject({ code: "INVALID_MEDIA_RESPONSE" });
    mockFetch(() => json({ name: "models/veo-3.1-generate-preview/operations/abc" }));
    await expect(startVideo({ prompt: "x" })).resolves.toMatchObject({ interactionId: "models/veo-3.1-generate-preview/operations/abc" });
  });

  it("refuses operation names that could escape the operations path", async () => {
    mockFetch(() => json({ done: false }));
    await expect(getVideoOperation("../files/secret")).rejects.toMatchObject({ code: "INVALID_MEDIA_RESPONSE" });
    await expect(getVideoOperation("operations/x?key=1")).rejects.toMatchObject({ code: "INVALID_MEDIA_RESPONSE" });
    await expect(getVideoOperation("models/veo-3.1-generate-preview/operations/abc")).resolves.toEqual({ done: false });
  });

  it("extracts the completed video uri and tolerates malformed payloads", () => {
    const ok = { response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media" } }] } } };
    expect(getCompletedVideoUri(ok)).toContain("/files/abc");
    expect(getCompletedVideoUri(null)).toBe("");
    expect(getCompletedVideoUri({ response: {} })).toBe("");
    expect(getCompletedVideoUri({ response: { generateVideoResponse: { generatedSamples: [] } } })).toBe("");
  });
});

describe("downloadFile", () => {
  const uri = "https://generativelanguage.googleapis.com/v1beta/files/abc:download?alt=media";

  it("only talks to https googleapis hosts and never sends the key elsewhere", async () => {
    mockFetch(() => new Response("x"));
    await expect(downloadFile("https://evil.example.com/video.mp4")).rejects.toMatchObject({ code: "MEDIA_DOWNLOAD_FAILED" });
    await expect(downloadFile("http://generativelanguage.googleapis.com/x")).rejects.toMatchObject({ code: "MEDIA_DOWNLOAD_FAILED" });
    await expect(downloadFile("https://googleapis.com.evil.example/x")).rejects.toMatchObject({ code: "MEDIA_DOWNLOAD_FAILED" });
    expect(calls).toHaveLength(0);
  });

  it("follows a redirect by hand and drops the API key for non-Google targets", async () => {
    mockFetch(url => url.startsWith("https://generativelanguage.googleapis.com")
      ? new Response(null, { status: 302, headers: { location: "https://storage.example.net/blob/video.mp4" } })
      : new Response("video-bytes", { status: 200, headers: { "content-type": "video/mp4", "content-length": "11" } }));
    const result = await downloadFile(uri);
    expect(result.status).toBe(200);
    expect(calls[0].headers["x-goog-api-key"]).toBe("test-key");
    expect(calls[1].url).toBe("https://storage.example.net/blob/video.mp4");
    expect(calls[1].headers["x-goog-api-key"]).toBeUndefined();
  });

  it("forwards Range and exposes 206 metadata, with a safe content type", async () => {
    mockFetch(() => new Response("ab", { status: 206, headers: { "content-type": "text/html", "content-range": "bytes 0-1/10", "content-length": "2" } }));
    const result = await downloadFile(uri, undefined, "bytes=0-1");
    expect(calls[0].headers.Range).toBe("bytes=0-1");
    expect(result.status).toBe(206);
    expect(result.contentRange).toBe("bytes 0-1/10");
    expect(result.contentType).toBe("video/mp4");
  });

  it("ignores malformed Range headers and fails on upstream errors", async () => {
    mockFetch(() => new Response("nope", { status: 500 }));
    await expect(downloadFile(uri, undefined, "bytes=abc")).rejects.toMatchObject({ code: "MEDIA_DOWNLOAD_FAILED", retryable: true });
    expect(calls[0].headers.Range).toBeUndefined();
  });
});
