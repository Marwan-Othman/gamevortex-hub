# GameVortex AI self-hosted runtime

This service runs the Ollama model and a small authenticated gateway on infrastructure you control. It does not call an AI provider. The website on Vercel connects to the gateway; it cannot connect to `127.0.0.1` on your phone or computer.

## Run on an always-on Docker host

1. Install Docker Engine and the Docker Compose plugin on a Linux host that will stay online.
2. In this folder, copy `.env.example` to `.env` and replace the token with at least 64 random hexadecimal characters. For example, generate one with `openssl rand -hex 32`. Do not commit `.env`.
3. From the project root, start the services:

   ```sh
   docker compose --env-file self-hosted-ai/.env -f self-hosted-ai/docker-compose.yml up -d --build
   docker compose --env-file self-hosted-ai/.env -f self-hosted-ai/docker-compose.yml exec ollama ollama pull qwen3:1.7b
   ```

4. The gateway listens on the host at `127.0.0.1:8081`. Configure your HTTPS reverse proxy to forward `https://ai.your-domain.example` to that address. Preserve streaming responses and disable response buffering. Do not expose Ollama port `11434`; Compose keeps it on the private service network. Keep port `8081` restricted to the host/reverse proxy.
5. Add these server-side environment variables to the Vercel project for the environments you deploy. Use the **same model and token** as the runtime host, then redeploy:

   ```env
   GAMEVORTEX_AI_RUNTIME_URL=https://ai.your-domain.example
   GAMEVORTEX_AI_MODEL=qwen3:1.7b
   GAMEVORTEX_AI_RUNTIME_TOKEN=the-same-random-token
   ```

6. Check `https://ai.your-domain.example/health` returns `{"ok":true}`, then sign in to GameVortex Hub and send a test message from `/ai`.

Vercel's runtime URL must be reachable over HTTPS from Vercel. A phone-only `http://127.0.0.1:11434` URL will never point to Ollama from Vercel. If you host the gateway on Android instead, you still need a stable HTTPS route to that phone and must keep Ollama, the gateway, and the network tunnel running; the phone needs to remain online. For a durable deployment, use an always-on host.

## Gateway protections

- Requires a non-placeholder bearer secret of at least 64 characters and compares it without a timing-sensitive string comparison.
- Exposes only `POST /api/chat` plus a minimal health endpoint.
- Fixes the model name from server configuration and forwards only system/user/assistant messages. Client-provided tools, model overrides, and runtime options are discarded.
- Limits request size and conversation context, streams Ollama output, and logs only generic upstream failure codes.
- The token is not a substitute for HTTPS. Keep the gateway behind TLS and never expose the raw Ollama port.

The integration tests use a local mock Ollama HTTP server to verify authentication, input filtering, and streaming. A real answer still requires the model image and weights to be running on your host.
