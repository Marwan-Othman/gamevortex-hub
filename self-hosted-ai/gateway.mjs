import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { pathToFileURL } from "node:url";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_MESSAGES = 32;
const MAX_CONTEXT_CHARS = 512_000;

function json(res, statusCode, body) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function tokenMatches(header, expected) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const provided = Buffer.from(header.slice(7));
  const expectedBytes = Buffer.from(expected);
  const comparable = Buffer.alloc(expectedBytes.length);
  provided.copy(comparable, 0, 0, expectedBytes.length);
  return timingSafeEqual(expectedBytes, comparable) && provided.length === expectedBytes.length;
}

function parseUpstream(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error("OLLAMA_BASE_URL must be a valid URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("OLLAMA_BASE_URL must be an HTTP(S) URL without credentials, query or hash");
  }
  return url;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function normalizePayload(value, model) {
  if (!value || typeof value !== "object" || !Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > MAX_MESSAGES) {
    throw new Error("INVALID_MESSAGES");
  }

  let contextChars = 0;
  const messages = value.messages.map((message) => {
    if (!message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string") {
      throw new Error("INVALID_MESSAGES");
    }
    contextChars += message.content.length;
    if (contextChars > MAX_CONTEXT_CHARS) throw new Error("CONTEXT_TOO_LARGE");
    return { role: message.role, content: message.content };
  });

  // Do not forward client-controlled model names, tools, format or runtime options.
  return { model, stream: true, messages };
}

function checkModel(request, upstream, model) {
  return new Promise((resolve) => {
    let upstreamReq;
    try {
      upstreamReq = request({
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port || undefined,
        method: "GET",
        path: "/api/tags",
      }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > MAX_BODY_BYTES) upstreamReq.destroy();
        });
        response.on("end", () => {
          if (response.statusCode !== 200) return resolve("offline");
          try {
            const models = JSON.parse(body).models;
            if (!Array.isArray(models)) return resolve("offline");
            const installed = models.some((entry) => entry?.name === model || entry?.model === model);
            resolve(installed ? "ready" : "missing");
          } catch {
            resolve("offline");
          }
        });
      });
      upstreamReq.setTimeout(3_500, () => upstreamReq.destroy(new Error("UPSTREAM_TIMEOUT")));
      upstreamReq.on("error", () => resolve("offline"));
      upstreamReq.end();
    } catch {
      resolve("offline");
    }
  });
}

export function createAiGatewayServer({ token, model = "qwen3:1.7b", ollamaBaseUrl = "http://127.0.0.1:11434" }) {
  if (typeof token !== "string" || token.length < 64 || /^(.)\1+$/.test(token) || /replace|change.?me|example/i.test(token)) {
    throw new Error("GAMEVORTEX_AI_RUNTIME_TOKEN must be a non-placeholder secret of at least 64 characters");
  }
  if (typeof model !== "string" || !model.trim() || model.length > 128 || /[\u0000-\u0020]/.test(model)) throw new Error("GAMEVORTEX_AI_MODEL is invalid");
  const upstream = parseUpstream(ollamaBaseUrl);
  const upstreamRequest = upstream.protocol === "https:" ? httpsRequest : httpRequest;

  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      const status = await checkModel(upstreamRequest, upstream, model);
      const ready = status === "ready";
      return json(res, ready ? 200 : 503, {
        ok: ready,
        runtimeAvailable: status !== "offline",
        modelReady: ready,
      });
    }
    if (req.method !== "POST" || req.url !== "/api/chat") return json(res, 404, { error: "NOT_FOUND" });
    if (!tokenMatches(req.headers.authorization, token)) return json(res, 401, { error: "UNAUTHORIZED" });
    if (!String(req.headers["content-type"] || "").toLowerCase().includes("application/json")) return json(res, 415, { error: "JSON_REQUIRED" });

    let payload;
    try {
      const text = await readBody(req);
      try { payload = normalizePayload(JSON.parse(text), model); }
      catch (error) {
        const code = error instanceof Error ? error.message : "INVALID_REQUEST";
        const status = code === "CONTEXT_TOO_LARGE" ? 413 : 400;
        return json(res, status, { error: status === 413 ? "CONTEXT_TOO_LARGE" : "INVALID_REQUEST" });
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "INVALID_REQUEST";
      return json(res, code === "BODY_TOO_LARGE" ? 413 : 400, { error: code === "BODY_TOO_LARGE" ? code : "INVALID_REQUEST" });
    }

    const body = JSON.stringify(payload);
    let upstreamReq;
    try {
      upstreamReq = upstreamRequest({
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port || undefined,
        method: "POST",
        path: "/api/chat",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
          "Content-Length": Buffer.byteLength(body),
        },
      }, (upstreamRes) => {
        const headers = {
          "Content-Type": upstreamRes.headers["content-type"] || "application/x-ndjson",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        };
        res.writeHead(upstreamRes.statusCode || 502, headers);
        upstreamRes.pipe(res);
      });

      upstreamReq.setTimeout(270_000, () => upstreamReq.destroy(new Error("UPSTREAM_TIMEOUT")));
      upstreamReq.on("error", (error) => {
        console.error(JSON.stringify({ event: "ai_gateway_upstream_error", code: error.message === "UPSTREAM_TIMEOUT" ? "TIMEOUT" : "UNAVAILABLE" }));
        if (!res.headersSent) json(res, error.message === "UPSTREAM_TIMEOUT" ? 504 : 502, { error: error.message === "UPSTREAM_TIMEOUT" ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE" });
        else if (!res.destroyed) res.destroy();
      });
      req.on("aborted", () => upstreamReq.destroy());
      res.on("close", () => { if (!res.writableEnded) upstreamReq.destroy(); });
      upstreamReq.end(body);
    } catch {
      if (!res.headersSent) json(res, 502, { error: "UPSTREAM_UNAVAILABLE" });
    }
  });

  server.headersTimeout = 15_000;
  server.requestTimeout = 20_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.GAMEVORTEX_AI_GATEWAY_PORT || "8081");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("GAMEVORTEX_AI_GATEWAY_PORT is invalid");
  const server = createAiGatewayServer({
    token: process.env.GAMEVORTEX_AI_RUNTIME_TOKEN,
    model: process.env.GAMEVORTEX_AI_MODEL || "qwen3:1.7b",
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  });
  server.listen(port, "0.0.0.0", () => console.log(`GameVortex AI runtime gateway listening on :${port}`));
}
