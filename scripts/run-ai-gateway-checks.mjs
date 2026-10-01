import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { createAiGatewayServer } from "../self-hosted-ai/gateway.mjs";

const token = "gamevortex-test-token-".padEnd(64, "x");
let ollama;
let gateway;
let gatewayUrl;
let forwardedPayload;
let upstreamCalls = 0;
let modelAvailable = true;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

before(async () => {
  ollama = createServer(async (req, res) => {
    upstreamCalls += 1;
    if (req.method === "GET" && req.url === "/api/tags") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: modelAvailable ? [{ name: "qwen3:1.7b" }] : [] }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    forwardedPayload = JSON.parse(body);
    res.writeHead(200, { "Content-Type": "application/x-ndjson" });
    res.write('{"message":{"content":"Local "}}' + String.fromCharCode(10));
    setTimeout(() => res.end('{"message":{"content":"answer"},"done":true}' + String.fromCharCode(10)), 5);
  });
  const ollamaPort = await listen(ollama);
  gateway = createAiGatewayServer({
    token,
    model: "qwen3:1.7b",
    ollamaBaseUrl: `http://127.0.0.1:${ollamaPort}`,
  });
  const gatewayPort = await listen(gateway);
  gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
});

after(async () => {
  await Promise.all([close(gateway), close(ollama)]);
});

test("health check responds without exposing runtime details", async () => {
  const response = await fetch(`${gatewayUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, runtimeAvailable: true, modelReady: true });
});

test("health check reports when the configured model is missing", async () => {
  modelAvailable = false;
  try {
    const response = await fetch(`${gatewayUrl}/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, runtimeAvailable: true, modelReady: false });
  } finally {
    modelAvailable = true;
  }
});

test("rejects requests without the gateway token", async () => {
  const beforeCalls = upstreamCalls;
  const response = await fetch(`${gatewayUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
  });
  assert.equal(response.status, 401);
  assert.equal(upstreamCalls, beforeCalls);
});

test("forces the configured model, drops tools, and streams Ollama output", async () => {
  const response = await fetch(`${gatewayUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: "attacker-controlled-model",
      tools: [{ name: "admin-delete" }],
      messages: [{ role: "user", content: "hello" }],
    }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
  const chunks = (await response.text()).trim().split(String.fromCharCode(10)).map((line) => JSON.parse(line));
  assert.deepEqual(chunks.map((chunk) => chunk.message?.content || ""), ["Local ", "answer"]);
  assert.equal(forwardedPayload.model, "qwen3:1.7b");
  assert.equal(forwardedPayload.stream, true);
  assert.deepEqual(forwardedPayload.messages, [{ role: "user", content: "hello" }]);
  assert.equal("tools" in forwardedPayload, false);
});

test("rejects malformed conversation roles before forwarding", async () => {
  const beforeCalls = upstreamCalls;
  const response = await fetch(`${gatewayUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messages: [{ role: "admin", content: "hello" }] }),
  });
  assert.equal(response.status, 400);
  assert.equal(upstreamCalls, beforeCalls);
});
