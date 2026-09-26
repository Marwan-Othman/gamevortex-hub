# GameVortex AI

## Implemented in the web app

- Owner-scoped conversation reads, renames, deletes, and message history.
- Arabic RTL and English LTR chat with streaming, stop, copy, code fences, conversation instructions, and true last-answer regeneration.
- A server-only Ollama-compatible runtime adapter. The browser never receives the runtime token.
- Safe error codes and request references; prompts, model output, runtime URLs, and tokens are not written to application logs.
- No site tools are registered. The model cannot access Games, Orders, Admin, Owner data, or database functions through chat.

## Requires a self-hosted model runtime

The Next.js app does not contain model weights and Vercel cannot run Ollama on your phone. `127.0.0.1` inside a Vercel Function points to that Function's own container, not your Android device. Chat will report a clear setup error until the app can reach your own runtime over HTTPS.

This repository includes a small authenticated gateway in [`../self-hosted-ai`](../self-hosted-ai/README.md). It accepts only authenticated chat requests, fixes the allowed model server-side, rejects tool parameters, and proxies streaming responses to Ollama. Keep Ollama's port `11434` private. Put the gateway behind HTTPS and do not publish its plain HTTP port directly to the Internet.

Configure the following **server-only** Vercel variables after the gateway is reachable:

```env
GAMEVORTEX_AI_RUNTIME_URL=https://ai.your-domain.example
GAMEVORTEX_AI_MODEL=qwen3:1.7b
GAMEVORTEX_AI_RUNTIME_TOKEN=<same random token as the gateway>
```

Generate the token with `openssl rand -hex 32`. Set it on the gateway and Vercel; never add a `NEXT_PUBLIC_` prefix. The production app requires HTTPS and a token for a remote runtime. For local development only, direct Ollama on `http://127.0.0.1:11434` is supported without a token.

## Verification status

- **Implemented:** web chat, database persistence, access checks, server-side runtime adapter, authenticated streaming gateway, and gateway tests.
- **Requires self-hosted model runtime:** real model responses. They cannot be tested until the gateway is running with Ollama and the model weights, then configured in Vercel.
- **Not implemented:** image/video generation, site action tools, long-term memory, and usage metering. No fake responses are generated when the runtime is missing.
